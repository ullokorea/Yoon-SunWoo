// 통계: 점주 대시보드·통계, 관리자 통계·이상 거래 탐지·운영 로그

import { STATUS_LABEL, kstDate, kstDateTime } from '@cheong/core';
import { audit, requireRole, type Actor, type Ctx } from '../context';
import { validation } from '../errors';
import { maskEmail } from '../security';
import { assertOwner } from './stores';
import { regionView, type RegionRow } from './weather';

export async function ownerDashboard(ctx: Ctx, actor: Actor | null, storeId: string) {
  await assertOwner(ctx.db, actor, storeId);
  const now = ctx.now();
  const start = kstDateTime(kstDate(now), '00:00');
  const end = new Date(start.getTime() + 86400_000);
  const [today] = await ctx.db.query<{ total: number; pending: number; confirmed: number; visited: number; discount: number }>(
    `select count(*) filter (where status not in ('REJECTED', 'EXPIRED'))::int as total,
            count(*) filter (where status = 'PENDING')::int as pending,
            count(*) filter (where status = 'CONFIRMED')::int as confirmed,
            count(*) filter (where status = 'VISITED')::int as visited,
            coalesce(sum(discount_amount) filter (where status = 'VISITED'), 0)::int as discount
       from reservations where store_id = $1 and slot_start_at >= $2 and slot_start_at < $3`,
    [storeId, start, end],
  );
  const [region] = await ctx.db.query<RegionRow>(
    `select w.* from stores s join weather_regions w on w.id = s.region_id where s.id = $1`,
    [storeId],
  );
  const live = await ctx.db.query<{ kind: string; rate: number; title: string; paused: boolean; status: string; auto_activate: boolean }>(
    `select kind, rate, title, paused, status, auto_activate from discount_campaigns where store_id = $1 and valid_until > $2 order by kind`,
    [storeId, now],
  );
  return { today, region: regionView(region!, now), campaigns: live };
}

/**
 * 점주 통계.
 * - '확정' = QR/예약번호로 방문 확인된 예약 기준
 * - '추정' = 예약 금액 기준 계산치. 실제 POS 결제 데이터가 아니다.
 */
export async function ownerStats(ctx: Ctx, actor: Actor | null, storeId: string, days = 30) {
  await assertOwner(ctx.db, actor, storeId);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw validation('기간이 올바르지 않아요.');
  const since = new Date(ctx.now().getTime() - days * 86400_000);
  const byStatus = await ctx.db.query<{ status: keyof typeof STATUS_LABEL; n: number }>(
    `select status, count(*)::int as n from reservations where store_id = $1 and created_at >= $2 group by status`,
    [storeId, since],
  );
  const [money] = await ctx.db.query<{ visited_discount: number; visited_total: number; upcoming_total: number; visited_guests: number }>(
    `select coalesce(sum(discount_amount) filter (where status = 'VISITED'), 0)::int as visited_discount,
            coalesce(sum(total_amount) filter (where status = 'VISITED'), 0)::int as visited_total,
            coalesce(sum(total_amount) filter (where status in ('PENDING', 'CONFIRMED')), 0)::int as upcoming_total,
            coalesce(sum(party_size) filter (where status = 'VISITED'), 0)::int as visited_guests
       from reservations where store_id = $1 and created_at >= $2`,
    [storeId, since],
  );
  const byWeather = await ctx.db.query<{ mode: string; n: number; visited: number }>(
    `select weather_mode_at_booking as mode, count(*)::int as n, count(*) filter (where status = 'VISITED')::int as visited
       from reservations where store_id = $1 and created_at >= $2 group by weather_mode_at_booking order by n desc`,
    [storeId, since],
  );
  const byKind = await ctx.db.query<{ kind: string; n: number }>(
    `select campaign_kind as kind, count(*)::int as n from reservations where store_id = $1 and created_at >= $2 group by campaign_kind`,
    [storeId, since],
  );
  const popular = await ctx.db.query<{ name: string; qty: number }>(
    `select i.menu_name as name, sum(i.quantity)::int as qty from reservation_items i join reservations r on r.id = i.reservation_id
      where r.store_id = $1 and r.created_at >= $2 and r.status in ('CONFIRMED', 'VISITED') group by i.menu_name order by qty desc limit 5`,
    [storeId, since],
  );
  const daily = await ctx.db.query<{ day: string; n: number; visited: number }>(
    `select to_char(slot_start_at + interval '9 hours', 'YYYY-MM-DD') as day, count(*)::int as n,
            count(*) filter (where status = 'VISITED')::int as visited
       from reservations where store_id = $1 and created_at >= $2 group by 1 order by 1`,
    [storeId, since],
  );
  return {
    periodDays: days,
    byStatus: byStatus.map((s) => ({ ...s, label: STATUS_LABEL[s.status] })),
    confirmed: {
      label: '확정 (방문 확인 기준)',
      visitedGuests: money!.visited_guests,
      discountGiven: money!.visited_discount,
    },
    estimated: {
      label: '추정 (예약 금액 기준 — 실제 결제 데이터 아님)',
      revenueFromVisited: money!.visited_total,
      revenueUpcoming: money!.upcoming_total,
    },
    byWeather,
    byKind,
    popularMenus: popular,
    daily,
  };
}

export async function adminOverview(ctx: Ctx, actor: Actor | null) {
  requireRole(actor, 'admin');
  const now = ctx.now();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const roles = await ctx.db.query<{ role: string; n: number }>(
    `select r.role, count(*)::int as n from user_roles r join users u on u.id = r.user_id where u.status = 'ACTIVE' group by r.role`,
  );
  const stores = await ctx.db.query<{ status: string; n: number }>(`select status, count(*)::int as n from stores group by status`);
  const reservations = await ctx.db.query<{ status: string; n: number }>(
    `select status, count(*)::int as n from reservations where created_at >= $1 group by status`,
    [since],
  );
  const pending = await ctx.db.query<{ stores: number; campaigns: number; reports: number }>(
    `select (select count(*)::int from stores where status = 'PENDING') as stores,
            (select count(*)::int from discount_campaigns where status = 'PENDING_REVIEW') as campaigns,
            (select count(*)::int from reports where status <> 'RESOLVED') as reports`,
  );
  const regions = (await ctx.db.query<RegionRow>(`select * from weather_regions order by name`)).map((r) => ({
    ...regionView(r, now),
    lastFetchAt: r.last_fetch_at,
  }));
  return {
    weatherSource: ctx.config.weatherSource,
    pushMode: ctx.config.pushMode,
    roles,
    stores,
    reservations30d: reservations.map((r) => ({ ...r, label: STATUS_LABEL[r.status as keyof typeof STATUS_LABEL] ?? r.status })),
    pending: pending[0],
    regions,
  };
}

/** 이상 거래 탐지 (규칙 기반, 운영자 확인용 — 자동 제재하지 않음) */
export async function adminAnomalies(ctx: Ctx, actor: Actor | null) {
  requireRole(actor, 'admin');
  const now = ctx.now();
  const noShows = await ctx.db.query<{ user_id: string; email: string; n: number }>(
    `select r.user_id, u.email, count(*)::int as n from reservations r join users u on u.id = r.user_id
      where r.status = 'NO_SHOW' and r.created_at >= $1 group by r.user_id, u.email having count(*) >= 3`,
    [new Date(now.getTime() - 30 * 86400_000)],
  );
  const bursts = await ctx.db.query<{ user_id: string; email: string; n: number }>(
    `select r.user_id, u.email, count(*)::int as n from reservations r join users u on u.id = r.user_id
      where r.created_at >= $1 group by r.user_id, u.email having count(*) >= 5`,
    [new Date(now.getTime() - 86400_000)],
  );
  const cancels = await ctx.db.query<{ user_id: string; email: string; n: number }>(
    `select r.user_id, u.email, count(*)::int as n from reservations r join users u on u.id = r.user_id
      where r.status = 'CANCELLED_BY_USER' and r.created_at >= $1 group by r.user_id, u.email having count(*) >= 5`,
    [new Date(now.getTime() - 7 * 86400_000)],
  );
  const qr = await ctx.db.query<{ store_id: string; name: string; n: number }>(
    `select q.store_id, s.name, count(*)::int as n from qr_verifications q join stores s on s.id = q.store_id
      where q.result in ('INVALID', 'REUSED', 'WRONG_STORE') and q.created_at >= $1 group by q.store_id, s.name having count(*) >= 5`,
    [new Date(now.getTime() - 86400_000)],
  );
  const mask = (rows: Array<{ user_id: string; email: string; n: number }>) => rows.map((r) => ({ userId: r.user_id, email: maskEmail(r.email), count: r.n }));
  return [
    { rule: '30일 내 노쇼 3회 이상', items: mask(noShows) },
    { rule: '24시간 내 예약 5건 이상', items: mask(bursts) },
    { rule: '7일 내 고객 취소 5건 이상', items: mask(cancels) },
    { rule: '24시간 내 비정상 QR 시도 5회 이상 (매장)', items: qr.map((r) => ({ storeId: r.store_id, store: r.name, count: r.n })) },
  ];
}

export async function adminAuditLogs(ctx: Ctx, actor: Actor | null, limit = 100) {
  requireRole(actor, 'admin');
  const rows = await ctx.db.query<{ email: string | null } & Record<string, unknown>>(
    `select a.action, a.actor_role as "actorRole", a.target_type as "targetType", a.target_id as "targetId", a.detail,
            a.created_at as "createdAt", u.email
       from audit_logs a left join users u on u.id = a.actor_user_id order by a.created_at desc limit $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return rows.map((r) => ({ ...r, email: r.email ? maskEmail(r.email) : null }));
}

export async function adminUsers(ctx: Ctx, actor: Actor | null) {
  requireRole(actor, 'admin');
  const rows = await ctx.db.query<{ id: string; email: string; status: string; nickname: string; roles: string[]; created_at: Date; reservations: number }>(
    `select u.id, u.email, u.status, p.nickname, u.created_at,
            array(select role from user_roles r where r.user_id = u.id) as roles,
            (select count(*)::int from reservations x where x.user_id = u.id) as reservations
       from users u join user_profiles p on p.user_id = u.id order by u.created_at desc limit 300`,
  );
  return rows.map((r) => ({
    id: r.id,
    email: maskEmail(r.email),
    status: r.status,
    nickname: r.nickname,
    roles: r.roles,
    reservations: r.reservations,
    createdAt: r.created_at,
  }));
}

export async function adminSetUserStatus(ctx: Ctx, actor: Actor | null, userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string) {
  const a = requireRole(actor, 'admin');
  if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw validation('상태가 올바르지 않아요.');
  if (!reason?.trim()) throw validation('사유를 입력해 주세요.');
  if (userId === a.userId) throw validation('자기 계정은 변경할 수 없어요.');
  await ctx.db.tx(async (q) => {
    await q.query(`update users set status = $2, updated_at = now() where id = $1 and status <> 'WITHDRAWN'`, [userId, status]);
    if (status === 'SUSPENDED') await q.query(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
    await audit(q, a, `USER_${status}`, 'user', userId, { reason });
  });
}

// ---------------- 신고·문의 ----------------

const REPORT_TYPES = ['STORE_ISSUE', 'DISCOUNT_MISMATCH', 'NO_SHOW_DISPUTE', 'INQUIRY', 'ETC'];

export async function createReport(
  ctx: Ctx,
  actor: Actor | null,
  input: { type: string; content: string; storeId?: string; reservationId?: string },
) {
  if (!actor) throw validation('로그인 후 문의할 수 있어요.');
  if (!REPORT_TYPES.includes(input.type)) throw validation('문의 유형을 선택해 주세요.');
  const content = String(input.content ?? '').trim();
  if (!content || content.length > 2000) throw validation('내용을 1~2000자로 입력해 주세요.');
  if (input.reservationId) {
    const r = await ctx.db.query(`select 1 from reservations where id = $1 and user_id = $2`, [input.reservationId, actor.userId]);
    if (!r.length) throw validation('본인 예약만 신고할 수 있어요.');
  }
  const [r] = await ctx.db.query<{ id: string }>(
    `insert into reports (reporter_user_id, store_id, reservation_id, type, content) values ($1, $2, $3, $4, $5) returning id`,
    [actor.userId, input.storeId ?? null, input.reservationId ?? null, input.type, content],
  );
  return r;
}

export async function adminReports(ctx: Ctx, actor: Actor | null) {
  requireRole(actor, 'admin');
  return ctx.db.query(
    `select r.id, r.type, r.content, r.status, r.admin_note as "adminNote", r.created_at as "createdAt", s.name as "storeName",
            x.code as "reservationCode"
       from reports r left join stores s on s.id = r.store_id left join reservations x on x.id = r.reservation_id
      order by r.created_at desc limit 200`,
  );
}

export async function adminUpdateReport(ctx: Ctx, actor: Actor | null, id: string, status: string, note?: string) {
  const a = requireRole(actor, 'admin');
  if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(status)) throw validation('상태가 올바르지 않아요.');
  await ctx.db.query(`update reports set status = $2, admin_note = $3, updated_at = now() where id = $1`, [id, status, note ?? null]);
  await audit(ctx.db, a, 'REPORT_UPDATE', 'report', id, { status });
}
