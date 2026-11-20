// 예약: 생성(트랜잭션), 취소, 점주 처리, QR 방문 확인
//
// 원칙
// - 가격·할인율은 서버가 DB 의 메뉴·캠페인으로 계산한다 (클라이언트 가격 무시)
// - 슬롯 수량 차감은 조건부 UPDATE (booked + n <= capacity) 로 원자적으로 처리
// - 캠페인 행을 FOR UPDATE 로 잠가 '하루 최대 예약 건수(선착순)' 경쟁을 직렬화
// - 확정 시점의 할인 조건을 예약에 스냅샷으로 저장 → 이후 날씨·캠페인 변경과 무관

import {
  CAMPAIGN_KIND_LABEL,
  PricingError,
  STATUS_LABEL,
  checkBookingEligibility,
  checkTransition,
  formatReservationCode,
  kstDate,
  kstDateTime,
  quotePrice,
  reservationTab,
  weatherMode,
  type ReservationAction,
  type ReservationStatus,
  type Role,
} from '@cheong/core';
import { audit, requireActor, requireRole, type Actor, type Ctx } from '../context';
import type { Queryable } from '../db';
import { AppError, conflict, forbidden, notFound, validation } from '../errors';
import { maskName, maskPhone, parseQrToken, randomCodeBytes, randomNonce, signQrToken } from '../security';
import { CAMPAIGN_SELECT, CATEGORY_LABEL, toCampaign, toMenu, toSlot, toStoreForBooking, type CampaignRow, type MenuRow, type SlotRow, type StoreRow } from './mappers';
import { enqueueNotification } from './notifications';
import { assertOwner } from './stores';
import { rowToState, type RegionRow } from './weather';

export interface CreateReservationInput {
  storeId: string;
  slotId: string;
  campaignId: string;
  partySize: number;
  items: Array<{ menuId: string; quantity: number }>;
}

interface ReservationRow {
  id: string;
  code: string;
  user_id: string;
  store_id: string;
  slot_id: string;
  campaign_id: string;
  party_size: number;
  status: ReservationStatus;
  campaign_kind: string;
  discount_rate: number;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  discount_capped: boolean;
  campaign_snapshot: Record<string, unknown>;
  weather_mode_at_booking: string;
  qr_nonce: string;
  status_reason: string | null;
  slot_start_at: Date;
  created_at: Date;
  confirmed_at: Date | null;
  visited_at: Date | null;
  cancelled_at: Date | null;
}

function block(message: string, code: string) {
  return new AppError('BOOKING_BLOCKED', message, { code });
}

function sanitizeInput(i: CreateReservationInput): CreateReservationInput {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(String(i.storeId)) || !uuid.test(String(i.slotId)) || !uuid.test(String(i.campaignId))) {
    throw validation('예약 정보가 올바르지 않아요.');
  }
  const partySize = Number(i.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) throw validation('인원을 확인해 주세요.');
  if (!Array.isArray(i.items) || i.items.length === 0 || i.items.length > 30) throw validation('메뉴를 1개 이상 선택해 주세요.');
  // 클라이언트가 price, discount 등을 보내도 여기서 버린다
  const items = i.items.map((it) => ({ menuId: String(it.menuId), quantity: Number(it.quantity) }));
  return { storeId: i.storeId, slotId: i.slotId, campaignId: i.campaignId, partySize, items };
}

/** 예약 전 견적 (쓰기 없음) */
export async function quoteReservation(ctx: Ctx, actor: Actor | null, raw: CreateReservationInput) {
  requireRole(actor, 'consumer');
  const input = sanitizeInput(raw);
  const now = ctx.now();
  const { store, slot, campaign, region, menus } = await loadBookingContext(ctx.db, input, false);
  const e = checkBookingEligibility({ region, store: toStoreForBooking(store), campaign, slot, partySize: input.partySize, now });
  if (!e.ok) throw block(e.message, e.code);
  try {
    const q = quotePrice(campaign, menus, input.items);
    return { ...q, campaignKind: campaign.kind, campaignTitle: campaign.title };
  } catch (err) {
    if (err instanceof PricingError) throw validation(err.message, { code: err.code });
    throw err;
  }
}

async function loadBookingContext(q: Queryable, input: CreateReservationInput, lock: boolean) {
  const forUpdate = lock ? ' for update' : '';
  const [store] = await q.query<StoreRow>(`select * from stores where id = $1`, [input.storeId]);
  if (!store) throw notFound('매장을 찾을 수 없어요.');
  const [campaignRow] = await q.query<CampaignRow>(`${CAMPAIGN_SELECT} where c.id = $1${forUpdate}`, [input.campaignId]);
  if (!campaignRow || campaignRow.store_id !== store.id) throw notFound('할인을 찾을 수 없어요.');
  const [slotRow] = await q.query<SlotRow>(`select * from reservation_slots where id = $1${forUpdate}`, [input.slotId]);
  if (!slotRow || slotRow.store_id !== store.id) throw notFound('예약 시간을 찾을 수 없어요.');
  const [regionRow] = await q.query<RegionRow>(`select * from weather_regions where id = $1`, [store.region_id]);
  const menus = (await q.query<MenuRow>(`select * from menus where store_id = $1`, [store.id])).map(toMenu);
  return { store, campaign: toCampaign(campaignRow), slot: toSlot(slotRow), region: rowToState(regionRow!), menus };
}

export async function createReservation(ctx: Ctx, actor: Actor | null, raw: CreateReservationInput) {
  const a = requireRole(actor, 'consumer');
  const input = sanitizeInput(raw);
  const now = ctx.now();

  const result = await ctx.db.tx(async (q) => {
    // 1. 캠페인·슬롯 잠금 후 최신 상태로 판정
    const { store, campaign, slot, region, menus } = await loadBookingContext(q, input, true);
    const e = checkBookingEligibility({ region, store: toStoreForBooking(store), campaign, slot, partySize: input.partySize, now });
    if (!e.ok) throw block(e.message, e.code);

    // 2. 중복 예약 방지: 같은 매장·같은 날 활성 예약이 이미 있으면 거부
    const dayStart = kstDateTime(kstDate(slot.startAt), '00:00');
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const dup = await q.query(
      `select 1 from reservations where user_id = $1 and store_id = $2 and status in ('PENDING', 'CONFIRMED')
          and slot_start_at >= $3 and slot_start_at < $4`,
      [a.userId, store.id, dayStart, dayEnd],
    );
    if (dup.length) throw conflict('같은 날 이 매장에 이미 예약이 있어요. 예약 내역을 확인해 주세요.', { code: 'DUPLICATE' });

    // 3. 선착순 일일 한도
    if (campaign.dailyLimit !== null) {
      const [cnt] = await q.query<{ n: number }>(
        `select count(*)::int as n from reservations where campaign_id = $1 and slot_start_at >= $2 and slot_start_at < $3
            and status in ('PENDING', 'CONFIRMED', 'VISITED', 'NO_SHOW')`,
        [campaign.id, dayStart, dayEnd],
      );
      if ((cnt?.n ?? 0) >= campaign.dailyLimit) throw block('오늘 준비된 할인 예약이 모두 마감됐어요.', 'DAILY_LIMIT');
    }

    // 4. 서버측 가격 계산
    let quote;
    try {
      quote = quotePrice(campaign, menus, input.items);
    } catch (err) {
      if (err instanceof PricingError) throw validation(err.message, { code: err.code });
      throw err;
    }

    // 5. 좌석 원자적 차감 (동시 요청에서도 초과 불가)
    const seat = await q.query(
      `update reservation_slots set booked = booked + $2, updated_at = now()
        where id = $1 and not closed and booked + $2 <= capacity returning booked`,
      [slot.id, input.partySize],
    );
    if (!seat.length) throw block('선택한 시간의 예약이 마감됐어요.', 'SLOT_FULL');

    // 6. 예약 생성 + 할인 조건 스냅샷
    const status: ReservationStatus = store.auto_approve ? 'CONFIRMED' : 'PENDING';
    const snapshot = {
      campaignId: campaign.id,
      title: campaign.title,
      kind: campaign.kind,
      rate: campaign.rate,
      scope: campaign.scope,
      menuIds: campaign.menuIds,
      maxDiscountAmount: campaign.maxDiscountAmount,
      minOrderAmount: campaign.minOrderAmount,
      dailyStartTime: campaign.dailyStartTime,
      dailyEndTime: campaign.dailyEndTime,
    };
    let code = '';
    for (let i = 0; i < 5; i++) {
      code = formatReservationCode(randomCodeBytes());
      const taken = await q.query(`select 1 from reservations where code = $1`, [code]);
      if (!taken.length) break;
    }
    const [res] = await q.query<{ id: string }>(
      `insert into reservations (code, user_id, store_id, slot_id, campaign_id, party_size, status, campaign_kind, discount_rate,
                                 subtotal, discount_amount, total_amount, discount_capped, campaign_snapshot, weather_mode_at_booking,
                                 qr_nonce, slot_start_at, created_at, updated_at, confirmed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18, $19) returning id`,
      [code, a.userId, store.id, slot.id, campaign.id, input.partySize, status, campaign.kind, campaign.rate, quote.subtotal, quote.discount,
        quote.total, quote.discountCapped, JSON.stringify(snapshot), weatherMode(region), randomNonce(), slot.startAt, now,
        status === 'CONFIRMED' ? now : null],
    );
    const id = res!.id;
    for (const l of quote.lines) {
      await q.query(
        `insert into reservation_items (reservation_id, menu_id, menu_name, unit_price, quantity, discount_rate, line_subtotal, line_discount)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, l.menuId, l.name, l.unitPrice, l.quantity, l.discountRate, l.lineSubtotal, l.lineDiscount],
      );
    }
    await q.query(
      `insert into reservation_status_history (reservation_id, from_status, to_status, actor_user_id, actor_role, created_at)
       values ($1, null, $2, $3, 'consumer', $4)`,
      [id, status, a.userId, now],
    );
    const owners = await q.query<{ user_id: string }>(`select user_id from store_owners where store_id = $1`, [store.id]);
    for (const o of owners) {
      await enqueueNotification(q, now, {
        userId: o.user_id,
        type: 'OWNER_NEW_RESERVATION',
        category: 'owner',
        title: status === 'PENDING' ? '승인 대기 중인 새 예약이 있어요' : '새 예약이 확정됐어요',
        body: `${code} · ${input.partySize}명 · ${kstHM(slot.startAt)}`,
        data: { reservationId: id, storeId: store.id },
      });
    }
    await enqueueNotification(q, now, {
      userId: a.userId,
      type: status === 'CONFIRMED' ? 'RESERVATION_CONFIRMED' : 'RESERVATION_REQUESTED',
      category: 'reservation',
      title: status === 'CONFIRMED' ? '예약이 확정됐어요 🐸' : '예약을 요청했어요',
      body: `${store.name} · ${kstHM(slot.startAt)} · ${campaign.rate}% 할인`,
      data: { reservationId: id },
    });
    return id;
  });
  return getReservation(ctx, a, result);
}

function kstHM(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

// ---------------- 조회 ----------------

async function getReservationRow(q: Queryable, id: string, lock = false): Promise<ReservationRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('예약을 찾을 수 없어요.');
  const [r] = await q.query<ReservationRow>(`select * from reservations where id = $1${lock ? ' for update' : ''}`, [id]);
  if (!r) throw notFound('예약을 찾을 수 없어요.');
  return r;
}

async function canView(q: Queryable, actor: Actor, r: ReservationRow): Promise<'consumer' | 'owner' | 'admin'> {
  if (r.user_id === actor.userId) return 'consumer';
  if (actor.roles.includes('owner')) {
    const own = await q.query(`select 1 from store_owners where store_id = $1 and user_id = $2`, [r.store_id, actor.userId]);
    if (own.length) return 'owner';
  }
  if (actor.roles.includes('admin')) return 'admin';
  // 존재 여부를 노출하지 않음
  throw notFound('예약을 찾을 수 없어요.');
}

export async function getReservation(ctx: Ctx, actor: Actor | null, id: string) {
  const a = requireActor(actor);
  const r = await getReservationRow(ctx.db, id);
  const view = await canView(ctx.db, a, r);
  const items = await ctx.db.query(
    `select menu_name as "name", unit_price as "unitPrice", quantity, discount_rate as "discountRate",
            line_subtotal as "lineSubtotal", line_discount as "lineDiscount"
       from reservation_items where reservation_id = $1`,
    [id],
  );
  const [store] = await ctx.db.query<{ name: string; address: string; phone: string | null; category: string; lat: number; lng: number }>(
    `select name, address, phone, category, lat, lng from stores where id = $1`,
    [r.store_id],
  );
  const [slot] = await ctx.db.query<{ duration_minutes: number }>(`select duration_minutes from reservation_slots where id = $1`, [r.slot_id]);
  const history = await ctx.db.query(
    `select from_status as "from", to_status as "to", actor_role as "actorRole", reason, created_at as "at"
       from reservation_status_history where reservation_id = $1 order by created_at`,
    [id],
  );
  let customer: { nickname: string; phone: string | null } | null = null;
  if (view !== 'consumer') {
    const [p] = await ctx.db.query<{ nickname: string; phone: string | null }>(`select nickname, phone from user_profiles where user_id = $1`, [
      r.user_id,
    ]);
    // 점주에게는 방문 확인에 필요한 최소 정보만, 관리자에게는 마스킹
    customer = p ? { nickname: view === 'admin' ? maskName(p.nickname) : p.nickname, phone: maskPhone(p.phone) } : null;
  }
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    tab: reservationTab(r.status),
    partySize: r.party_size,
    slotStartAt: r.slot_start_at,
    durationMinutes: slot?.duration_minutes ?? 60,
    campaignKind: r.campaign_kind,
    campaignKindLabel: CAMPAIGN_KIND_LABEL[r.campaign_kind as keyof typeof CAMPAIGN_KIND_LABEL] ?? r.campaign_kind,
    campaignTitle: String(r.campaign_snapshot.title ?? ''),
    discountRate: r.discount_rate,
    subtotal: r.subtotal,
    discountAmount: r.discount_amount,
    totalAmount: r.total_amount,
    discountCapped: r.discount_capped,
    weatherModeAtBooking: r.weather_mode_at_booking,
    statusReason: r.status_reason,
    createdAt: r.created_at,
    visitedAt: r.visited_at,
    items,
    history,
    store: { id: r.store_id, name: store?.name, address: store?.address, phone: store?.phone, category: CATEGORY_LABEL[store?.category ?? ''] ?? store?.category, lat: store?.lat, lng: store?.lng },
    customer,
    // QR 토큰은 예약자 본인 + 확정 상태에서만 발급
    qrToken: view === 'consumer' && r.status === 'CONFIRMED' ? signQrToken(ctx.config.qrSecret, r.id, r.qr_nonce) : null,
  };
}

export async function listMyReservations(ctx: Ctx, actor: Actor | null) {
  const a = requireRole(actor, 'consumer');
  const rows = await ctx.db.query<ReservationRow & { store_name: string }>(
    `select r.*, s.name as store_name from reservations r join stores s on s.id = r.store_id
      where r.user_id = $1 order by r.slot_start_at desc limit 100`,
    [a.userId],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    tab: reservationTab(r.status),
    storeId: r.store_id,
    storeName: r.store_name,
    slotStartAt: r.slot_start_at,
    partySize: r.party_size,
    discountRate: r.discount_rate,
    totalAmount: r.total_amount,
    discountAmount: r.discount_amount,
    campaignKind: r.campaign_kind,
  }));
}

export async function listStoreReservations(
  ctx: Ctx,
  actor: Actor | null,
  storeId: string,
  opts: { date?: string; status?: string } = {},
) {
  await assertOwner(ctx.db, actor, storeId);
  const params: unknown[] = [storeId];
  const where = ['r.store_id = $1'];
  if (opts.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw validation('날짜 형식 오류');
    const start = kstDateTime(opts.date, '00:00');
    params.push(start, new Date(start.getTime() + 86400_000));
    where.push(`r.slot_start_at >= $2 and r.slot_start_at < $3`);
  }
  if (opts.status) {
    params.push(opts.status);
    where.push(`r.status = $${params.length}`);
  }
  const rows = await ctx.db.query<ReservationRow & { nickname: string; phone: string | null; items: string }>(
    `select r.*, p.nickname, p.phone,
            (select string_agg(menu_name || ' x' || quantity, ', ') from reservation_items i where i.reservation_id = r.id) as items
       from reservations r join user_profiles p on p.user_id = r.user_id
      where ${where.join(' and ')} order by r.slot_start_at, r.created_at limit 300`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    slotStartAt: r.slot_start_at,
    partySize: r.party_size,
    customerName: r.nickname,
    customerPhone: maskPhone(r.phone),
    items: r.items,
    discountRate: r.discount_rate,
    subtotal: r.subtotal,
    discountAmount: r.discount_amount,
    totalAmount: r.total_amount,
    campaignKind: r.campaign_kind,
    createdAt: r.created_at,
  }));
}

// ---------------- 상태 변경 ----------------

/** 상태 변경 + 좌석 반환 + 이력. 트랜잭션 안에서 호출 (예약 행은 이미 잠금 상태여야 함) */
export async function releaseSeatsAndSetStatus(
  q: Queryable,
  reservationId: string,
  to: ReservationStatus,
  actor: Actor | null,
  reason: string | null,
  now: Date,
  actorRole?: Role | 'system',
) {
  const [r] = await q.query<ReservationRow>(`select * from reservations where id = $1`, [reservationId]);
  if (!r) throw notFound();
  const releases = ['REJECTED', 'EXPIRED', 'CANCELLED_BY_USER', 'CANCELLED_BY_STORE', 'CANCELLED_SAFETY'].includes(to);
  if (releases) {
    await q.query(`update reservation_slots set booked = greatest(0, booked - $2), updated_at = now() where id = $1`, [r.slot_id, r.party_size]);
  }
  await q.query(
    `update reservations set status = $2, status_reason = $3, updated_at = $4,
            confirmed_at = case when $2 = 'CONFIRMED' then $4 else confirmed_at end,
            visited_at = case when $2 = 'VISITED' then $4 else visited_at end,
            cancelled_at = case when $2 like 'CANCELLED%' or $2 in ('REJECTED', 'EXPIRED') then $4 else cancelled_at end
      where id = $1`,
    [reservationId, to, reason, now],
  );
  const role = actorRole ?? (actor ? (actor.roles.includes('owner') ? 'owner' : actor.roles.includes('admin') ? 'admin' : 'consumer') : 'system');
  await q.query(
    `insert into reservation_status_history (reservation_id, from_status, to_status, actor_user_id, actor_role, reason, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [reservationId, r.status, to, actor?.userId ?? null, role, reason, now],
  );
  return r;
}

async function transition(
  ctx: Ctx,
  actor: Actor,
  id: string,
  action: ReservationAction,
  role: Role | 'system',
  reason: string | null,
  guard?: (r: ReservationRow, q: Queryable) => Promise<void>,
) {
  const now = ctx.now();
  return ctx.db.tx(async (q) => {
    const r = await getReservationRow(q, id, true);
    if (guard) await guard(r, q);
    const t = checkTransition(action, r.status, role, { slotStartAt: r.slot_start_at, createdAt: r.created_at, now });
    if (!t.ok) throw conflict(t.message);
    await releaseSeatsAndSetStatus(q, id, t.to, actor, reason, now, role);
    return { r, to: t.to };
  });
}

/** 고객 취소. 지역이 위험 상태면 '기상 안전 취소'로 기록 */
export async function cancelByUser(ctx: Ctx, actor: Actor | null, id: string, reason?: string) {
  const a = requireRole(actor, 'consumer');
  const r0 = await getReservationRow(ctx.db, id);
  if (r0.user_id !== a.userId) throw notFound('예약을 찾을 수 없어요.');
  const [reg] = await ctx.db.query<{ safety_state: string }>(
    `select w.safety_state from stores s join weather_regions w on w.id = s.region_id where s.id = $1`,
    [r0.store_id],
  );
  const safety = reg?.safety_state === 'DANGER';
  const { r } = await transition(ctx, a, id, safety ? 'CANCEL_SAFETY' : 'CANCEL_BY_USER', 'consumer', reason?.slice(0, 200) ?? null, async (row) => {
    if (row.user_id !== a.userId) throw notFound('예약을 찾을 수 없어요.');
  });
  await notifyOwners(ctx, r.store_id, 'OWNER_RESERVATION_CANCELLED', '예약이 취소됐어요', `${r.code} · ${kstHM(r.slot_start_at)} · ${r.party_size}명`);
  return getReservation(ctx, a, id);
}

async function notifyOwners(ctx: Ctx, storeId: string, type: string, title: string, body: string) {
  const owners = await ctx.db.query<{ user_id: string }>(`select user_id from store_owners where store_id = $1`, [storeId]);
  for (const o of owners) await enqueueNotification(ctx.db, ctx.now(), { userId: o.user_id, type, category: 'owner', title, body, data: { storeId } });
}

const OWNER_ACTIONS = ['APPROVE', 'REJECT', 'CANCEL_BY_STORE', 'CANCEL_SAFETY', 'NO_SHOW'] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];

export async function ownerAction(ctx: Ctx, actor: Actor | null, storeId: string, id: string, action: OwnerAction, reason?: string) {
  if (!OWNER_ACTIONS.includes(action)) throw validation('알 수 없는 처리예요.');
  const a = await assertOwner(ctx.db, actor, storeId);
  if ((action === 'REJECT' || action === 'CANCEL_BY_STORE') && !reason?.trim()) throw validation('고객에게 안내할 사유를 입력해 주세요.');
  const { r, to } = await transition(ctx, a, id, action, 'owner', reason?.trim().slice(0, 200) ?? null, async (row) => {
    if (row.store_id !== storeId) throw notFound('예약을 찾을 수 없어요.');
  });
  await audit(ctx.db, a, `RESERVATION_${action}`, 'reservation', id, { storeId, reason });
  const msg: Record<string, [string, string]> = {
    CONFIRMED: ['예약이 확정됐어요 🐸', '방문 시 예약 QR 코드를 보여주세요.'],
    REJECTED: ['예약이 거절됐어요', reason ?? ''],
    CANCELLED_BY_STORE: ['매장 사정으로 예약이 취소됐어요', reason ?? ''],
    CANCELLED_SAFETY: ['기상 안전을 위해 예약이 취소됐어요', '안전한 날 다시 만나요. 혜택은 다음에 이용할 수 있어요.'],
    NO_SHOW: ['예약 시간에 방문하지 않아 노쇼로 처리됐어요', '문의는 마이페이지 > 고객센터를 이용해 주세요.'],
  };
  const m = msg[to];
  if (m) {
    await enqueueNotification(ctx.db, ctx.now(), {
      userId: r.user_id,
      type: `RESERVATION_${to}`,
      category: 'reservation',
      title: m[0],
      body: `${r.code} · ${m[1]}`,
      data: { reservationId: id },
    });
  }
  return { id, status: to };
}

/**
 * QR 방문 확인. token(QR) 또는 code(예약번호) 중 하나.
 * 모든 시도는 qr_verifications 에 기록된다 (재사용·위조 시도 탐지용).
 */
export async function verifyVisit(ctx: Ctx, actor: Actor | null, storeId: string, input: { token?: string; code?: string }) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const now = ctx.now();
  const record = (reservationId: string | null, result: string) =>
    ctx.db.query(`insert into qr_verifications (reservation_id, store_id, scanned_by, result, created_at) values ($1, $2, $3, $4, $5)`, [
      reservationId,
      storeId,
      a.userId,
      result,
      now,
    ]);

  let reservationId: string | null = null;
  if (input.token) {
    const parsed = parseQrToken(ctx.config.qrSecret, input.token);
    if (!parsed) {
      await record(null, 'INVALID');
      throw validation('유효하지 않은 QR 코드예요.', { result: 'INVALID' });
    }
    const [r] = await ctx.db.query<{ id: string; qr_nonce: string }>(`select id, qr_nonce from reservations where id = $1`, [parsed.reservationId]);
    if (!r || r.qr_nonce !== parsed.nonce) {
      await record(null, 'INVALID');
      throw validation('유효하지 않은 QR 코드예요.', { result: 'INVALID' });
    }
    reservationId = r.id;
  } else if (input.code) {
    const code = input.code.trim().toUpperCase();
    const [r] = await ctx.db.query<{ id: string }>(`select id from reservations where code = $1 and store_id = $2`, [code, storeId]);
    if (!r) {
      await record(null, 'INVALID');
      throw notFound('이 매장의 예약번호가 아니에요.');
    }
    reservationId = r.id;
  } else {
    throw validation('QR 코드 또는 예약번호를 입력해 주세요.');
  }

  const r = await getReservationRow(ctx.db, reservationId);
  if (r.store_id !== storeId) {
    await record(reservationId, 'WRONG_STORE');
    throw forbidden('다른 매장의 예약이에요.');
  }
  if (r.status === 'VISITED') {
    await record(reservationId, 'REUSED');
    throw conflict('이미 방문 확인된 예약이에요. (QR 재사용)', { result: 'REUSED' });
  }
  if (r.status !== 'CONFIRMED') {
    await record(reservationId, 'NOT_CONFIRMED');
    throw conflict(`방문 확인할 수 없는 예약이에요. (${STATUS_LABEL[r.status]})`, { result: 'NOT_CONFIRMED' });
  }
  try {
    await ctx.db.tx(async (q) => {
      const locked = await getReservationRow(q, reservationId!, true);
      const t = checkTransition('VISIT', locked.status, 'owner', { slotStartAt: locked.slot_start_at, createdAt: locked.created_at, now });
      if (!t.ok) throw conflict(t.message, { result: locked.status === 'VISITED' ? 'REUSED' : 'OUT_OF_WINDOW' });
      // 부분 유니크 인덱스(qr_success_once_uq)가 동시 스캔에서도 1회만 성공하도록 보장
      await q.query(`insert into qr_verifications (reservation_id, store_id, scanned_by, result, created_at) values ($1, $2, $3, 'SUCCESS', $4)`, [
        reservationId,
        storeId,
        a.userId,
        now,
      ]);
      await releaseSeatsAndSetStatus(q, reservationId!, 'VISITED', a, null, now, 'owner');
    });
  } catch (e) {
    if (e instanceof AppError) {
      const result = (e.detail as { result?: string } | undefined)?.result ?? 'OUT_OF_WINDOW';
      await record(reservationId, result === 'REUSED' ? 'REUSED' : 'OUT_OF_WINDOW');
      throw e;
    }
    // 유니크 위반 = 동시 재사용
    await record(reservationId, 'REUSED');
    throw conflict('이미 방문 확인된 예약이에요. (QR 재사용)', { result: 'REUSED' });
  }
  await audit(ctx.db, a, 'RESERVATION_VISIT', 'reservation', reservationId, { storeId, via: input.token ? 'QR' : 'CODE' });
  return getReservation(ctx, a, reservationId);
}

/** 승인 지연 예약 만료 (주기 작업) */
export async function expirePendingReservations(ctx: Ctx) {
  const now = ctx.now();
  const rows = await ctx.db.query<{ id: string; user_id: string; code: string }>(
    `select id, user_id, code from reservations where status = 'PENDING' and (created_at <= $1 or slot_start_at <= $2)`,
    [new Date(now.getTime() - 30 * 60_000), now],
  );
  for (const r of rows) {
    await ctx.db.tx(async (q) => {
      const locked = await getReservationRow(q, r.id, true);
      if (locked.status !== 'PENDING') return;
      await releaseSeatsAndSetStatus(q, r.id, 'EXPIRED', null, '점주 승인 지연', now, 'system');
      await enqueueNotification(q, now, {
        userId: r.user_id,
        type: 'RESERVATION_EXPIRED',
        category: 'reservation',
        title: '매장 승인이 지연되어 예약이 취소됐어요',
        body: `${r.code} · 다른 매장의 할인을 확인해 보세요.`,
        data: { reservationId: r.id },
      });
    });
  }
  return rows.length;
}

/** 방문 예정 알림 (주기 작업): 1시간 이내 시작하는 확정 예약 */
export async function remindUpcoming(ctx: Ctx) {
  const now = ctx.now();
  const rows = await ctx.db.query<{ id: string; user_id: string; code: string; name: string; slot_start_at: Date }>(
    `select r.id, r.user_id, r.code, s.name, r.slot_start_at from reservations r join stores s on s.id = r.store_id
      where r.status = 'CONFIRMED' and r.slot_start_at > $1 and r.slot_start_at <= $2`,
    [now, new Date(now.getTime() + 60 * 60_000)],
  );
  for (const r of rows) {
    await enqueueNotification(ctx.db, now, {
      userId: r.user_id,
      type: 'RESERVATION_REMINDER',
      category: 'reservation',
      title: '곧 방문 시간이에요 🐸',
      body: `${r.name} · ${kstHM(r.slot_start_at)} · 예약 QR을 준비해 주세요.`,
      data: { reservationId: r.id },
      dedupeKey: `remind:${r.id}`,
    });
  }
  return rows.length;
}

// ---------------- 관리자 ----------------

export async function adminListReservations(ctx: Ctx, actor: Actor | null, status?: string) {
  requireRole(actor, 'admin');
  const rows = await ctx.db.query<ReservationRow & { store_name: string; nickname: string }>(
    `select r.*, s.name as store_name, p.nickname from reservations r
       join stores s on s.id = r.store_id join user_profiles p on p.user_id = r.user_id
      ${status ? 'where r.status = $1' : ''} order by r.created_at desc limit 200`,
    status ? [status] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    storeName: r.store_name,
    customer: maskName(r.nickname),
    slotStartAt: r.slot_start_at,
    partySize: r.party_size,
    discountRate: r.discount_rate,
    totalAmount: r.total_amount,
    campaignKind: r.campaign_kind,
    weatherMode: r.weather_mode_at_booking,
    createdAt: r.created_at,
  }));
}
