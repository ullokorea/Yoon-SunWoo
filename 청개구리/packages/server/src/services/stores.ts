// 매장: 소비자 탐색·상세, 점주 관리, 관리자 승인

import {
  CAMPAIGN_KIND_LABEL,
  checkBookingEligibility,
  distanceMeters,
  isCampaignLive,
  isValidBusinessNumber,
  isValidHHMM,
  isWithinBusinessHours,
  kstDateTime,
  parseHHMM,
  type BusinessHours,
  type Campaign,
  type RegionWeatherState,
  type Slot,
} from '@cheong/core';
import { audit, requireRole, type Actor, type Ctx } from '../context';
import type { Queryable } from '../db';
import { badRequest, forbidden, notFound, validation } from '../errors';
import { maskEmail } from '../security';
import {
  CAMPAIGN_SELECT,
  CATEGORY_LABEL,
  menuView,
  toCampaign,
  toSlot,
  toStoreForBooking,
  type CampaignRow,
  type MenuRow,
  type SlotRow,
  type StoreRow,
} from './mappers';
import { enqueueNotification } from './notifications';
import { ensureRegionForPoint, regionView, rowToState, type RegionRow } from './weather';

const CATEGORIES = Object.keys(CATEGORY_LABEL);

// ---------------- 공통 조회 ----------------

export async function getStoreRow(q: Queryable, id: string): Promise<StoreRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('매장을 찾을 수 없어요.');
  const [s] = await q.query<StoreRow>(`select * from stores where id = $1`, [id]);
  if (!s) throw notFound('매장을 찾을 수 없어요.');
  return s;
}

/** 점주가 이 매장의 소유자인지 서버에서 확인 */
export async function assertOwner(q: Queryable, actor: Actor | null, storeId: string): Promise<Actor> {
  const a = requireRole(actor, 'owner');
  const r = await q.query(`select 1 from store_owners where store_id = $1 and user_id = $2`, [storeId, a.userId]);
  if (!r.length) throw forbidden('이 매장을 관리할 권한이 없어요.');
  return a;
}

interface Offer {
  campaignId: string;
  kind: Campaign['kind'];
  kindLabel: string;
  rate: number;
  title: string;
}

/** 슬롯마다 지금 예약 가능한 가장 높은 할인 */
function bestOfferForSlot(
  region: RegionWeatherState,
  store: StoreRow,
  campaigns: Campaign[],
  slot: Slot,
  now: Date,
): { offer: Offer | null; blockReason: string | null } {
  let best: Offer | null = null;
  let reason: string | null = null;
  for (const c of campaigns) {
    const e = checkBookingEligibility({ region, store: toStoreForBooking(store), campaign: c, slot, partySize: 1, now });
    if (e.ok) {
      if (!best || c.rate > best.rate) best = { campaignId: c.id, kind: c.kind, kindLabel: CAMPAIGN_KIND_LABEL[c.kind], rate: c.rate, title: c.title };
    } else if (!reason) {
      reason = e.message;
    }
  }
  return { offer: best, blockReason: best ? null : reason };
}

async function loadCampaigns(q: Queryable, storeIds: string[], now: Date): Promise<Map<string, Campaign[]>> {
  const map = new Map<string, Campaign[]>();
  if (!storeIds.length) return map;
  const rows = await q.query<CampaignRow>(
    `${CAMPAIGN_SELECT} where c.store_id = any($1::uuid[]) and c.status = 'APPROVED' and c.valid_until > $2`,
    [storeIds, now],
  );
  for (const r of rows) {
    const list = map.get(r.store_id) ?? [];
    list.push(toCampaign(r));
    map.set(r.store_id, list);
  }
  return map;
}

async function loadSlots(q: Queryable, storeIds: string[], from: Date, to: Date): Promise<Map<string, Slot[]>> {
  const map = new Map<string, Slot[]>();
  if (!storeIds.length) return map;
  const rows = await q.query<SlotRow>(
    `select * from reservation_slots where store_id = any($1::uuid[]) and start_at >= $2 and start_at < $3 order by start_at`,
    [storeIds, from, to],
  );
  for (const r of rows) {
    const list = map.get(r.store_id) ?? [];
    list.push(toSlot(r));
    map.set(r.store_id, list);
  }
  return map;
}

// ---------------- 소비자: 탐색 ----------------

export interface ListStoresInput {
  lat?: number;
  lng?: number;
  regionId?: string;
  sort?: 'distance' | 'discount';
  category?: string;
  priceLevel?: number;
  availableOnly?: boolean;
  storeIds?: string[];
}

export async function listStores(ctx: Ctx, input: ListStoresInput, actor?: Actor | null) {
  const now = ctx.now();
  const params: unknown[] = [];
  const where = [`s.status = 'APPROVED'`];
  if (input.regionId) {
    params.push(input.regionId);
    where.push(`s.region_id = $${params.length}`);
  }
  if (input.category) {
    if (!CATEGORIES.includes(input.category)) throw validation('음식 종류가 올바르지 않아요.');
    params.push(input.category);
    where.push(`s.category = $${params.length}`);
  }
  if (input.priceLevel) {
    params.push(input.priceLevel);
    where.push(`s.price_level = $${params.length}`);
  }
  if (input.storeIds) {
    params.push(input.storeIds);
    where.push(`s.id = any($${params.length}::uuid[])`);
  }
  const stores = await ctx.db.query<StoreRow & { image_url: string | null }>(
    `select s.*, (select url from store_images i where i.store_id = s.id order by sort_order limit 1) as image_url
       from stores s where ${where.join(' and ')}`,
    params,
  );
  const regionIds = [...new Set(stores.map((s) => s.region_id))];
  const regions = new Map(
    (regionIds.length
      ? await ctx.db.query<RegionRow>(`select * from weather_regions where id = any($1::uuid[])`, [regionIds])
      : []
    ).map((r) => [r.id, r]),
  );
  const ids = stores.map((s) => s.id);
  const campaigns = await loadCampaigns(ctx.db, ids, now);
  const slots = await loadSlots(ctx.db, ids, now, new Date(now.getTime() + 4 * 86400_000));
  const favs = actor
    ? new Set((await ctx.db.query<{ store_id: string }>(`select store_id from favorites where user_id = $1`, [actor.userId])).map((f) => f.store_id))
    : new Set<string>();

  const out = stores.map((s) => {
    const regionRow = regions.get(s.region_id)!;
    const region = rowToState(regionRow);
    const cs = campaigns.get(s.id) ?? [];
    const live = cs.filter((c) => isCampaignLive(c, region, now));
    const offers = (slots.get(s.id) ?? []).map((sl) => ({ slot: sl, ...bestOfferForSlot(region, s, cs, sl, now) }));
    const next = offers.find((o) => o.offer);
    const rainPreview = Math.max(0, ...cs.filter((c) => c.kind === 'RAIN' && !c.paused).map((c) => c.rate));
    const typhoonRates = cs.filter((c) => c.kind !== 'RAIN' && !c.paused).map((c) => c.rate);
    const distance = input.lat !== undefined && input.lng !== undefined ? distanceMeters({ lat: input.lat, lng: input.lng }, s) : null;
    return {
      id: s.id,
      name: s.name,
      category: s.category,
      categoryLabel: CATEGORY_LABEL[s.category] ?? s.category,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      priceLevel: s.price_level,
      imageUrl: s.image_url,
      isSample: s.is_sample,
      operationPaused: s.operation_paused,
      distanceMeters: distance,
      region: { id: regionRow.id, name: regionRow.name, mode: regionView(regionRow, now).mode, isMock: regionRow.last_source === 'MOCK' },
      liveRate: live.length ? Math.max(...live.map((c) => c.rate)) : null,
      liveKinds: [...new Set(live.map((c) => c.kind))],
      rainPreviewRate: rainPreview || null,
      typhoonMaxRate: typhoonRates.length ? Math.max(...typhoonRates) : null,
      bookable: !!next,
      nextSlot: next ? { slotId: next.slot.id, startAt: next.slot.startAt, rate: next.offer!.rate, kind: next.offer!.kind } : null,
      isFavorite: favs.has(s.id),
    };
  });

  const filtered = input.availableOnly ? out.filter((s) => s.bookable) : out;
  filtered.sort((a, b) => {
    if (input.sort === 'discount') return (b.liveRate ?? -1) - (a.liveRate ?? -1) || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
    if (a.distanceMeters !== null && b.distanceMeters !== null) return a.distanceMeters - b.distanceMeters;
    return (b.liveRate ?? -1) - (a.liveRate ?? -1) || a.name.localeCompare(b.name);
  });
  return filtered;
}

export async function getStoreDetail(ctx: Ctx, storeId: string, actor?: Actor | null) {
  const now = ctx.now();
  const s = await getStoreRow(ctx.db, storeId);
  if (s.status !== 'APPROVED') {
    // 미승인 매장은 소유 점주·관리자만 볼 수 있다
    const isAdmin = actor?.roles.includes('admin');
    const own = actor ? (await ctx.db.query(`select 1 from store_owners where store_id = $1 and user_id = $2`, [storeId, actor.userId])).length > 0 : false;
    if (!isAdmin && !own) throw notFound('매장을 찾을 수 없어요.');
  }
  const [regionRow] = await ctx.db.query<RegionRow>(`select * from weather_regions where id = $1`, [s.region_id]);
  const region = rowToState(regionRow!);
  const menus = await ctx.db.query<MenuRow>(`select * from menus where store_id = $1 order by sort_order, name`, [storeId]);
  const images = await ctx.db.query<{ url: string }>(`select url from store_images where store_id = $1 order by sort_order`, [storeId]);
  const campaigns = (await loadCampaigns(ctx.db, [storeId], now)).get(storeId) ?? [];
  const slots = (await loadSlots(ctx.db, [storeId], now, new Date(now.getTime() + 4 * 86400_000))).get(storeId) ?? [];
  const fav = actor
    ? (await ctx.db.query(`select 1 from favorites where user_id = $1 and store_id = $2`, [actor.userId, storeId])).length > 0
    : false;

  return {
    id: s.id,
    name: s.name,
    category: s.category,
    categoryLabel: CATEGORY_LABEL[s.category] ?? s.category,
    description: s.description,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    phone: s.phone,
    priceLevel: s.price_level,
    businessHours: s.business_hours,
    operationPaused: s.operation_paused,
    isSample: s.is_sample,
    autoApprove: s.auto_approve,
    images: images.map((i) => i.url),
    region: regionView(regionRow!, now),
    isFavorite: fav,
    menus: menus.filter((m) => m.is_available).map(menuView),
    campaigns: campaigns
      .filter((c) => !c.paused)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        kindLabel: CAMPAIGN_KIND_LABEL[c.kind],
        title: c.title,
        rate: c.rate,
        scope: c.scope,
        menuIds: c.menuIds,
        dailyStartTime: c.dailyStartTime,
        dailyEndTime: c.dailyEndTime,
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        maxDiscountAmount: c.maxDiscountAmount,
        minOrderAmount: c.minOrderAmount,
        maxPartySize: c.maxPartySize,
        dailyLimit: c.dailyLimit,
        live: isCampaignLive(c, region, now),
      })),
    slots: slots.map((sl) => {
      const { offer, blockReason } = bestOfferForSlot(region, s, campaigns, sl, now);
      return {
        id: sl.id,
        startAt: sl.startAt,
        durationMinutes: sl.durationMinutes,
        remaining: Math.max(0, sl.capacity - sl.booked),
        offer,
        blockReason,
      };
    }),
  };
}

// ---------------- 즐겨찾기 ----------------

export async function setFavorite(ctx: Ctx, actor: Actor | null, storeId: string, on: boolean, notify = true) {
  const a = requireRole(actor, 'consumer');
  await getStoreRow(ctx.db, storeId);
  if (on) {
    await ctx.db.query(
      `insert into favorites (user_id, store_id, notify) values ($1, $2, $3)
       on conflict (user_id, store_id) do update set notify = excluded.notify`,
      [a.userId, storeId, notify],
    );
  } else {
    await ctx.db.query(`delete from favorites where user_id = $1 and store_id = $2`, [a.userId, storeId]);
  }
}

export async function listFavorites(ctx: Ctx, actor: Actor | null, lat?: number, lng?: number) {
  const a = requireRole(actor, 'consumer');
  const rows = await ctx.db.query<{ store_id: string; notify: boolean }>(`select store_id, notify from favorites where user_id = $1`, [a.userId]);
  if (!rows.length) return [];
  const notify = new Map(rows.map((r) => [r.store_id, r.notify]));
  const stores = await listStores(ctx, { storeIds: rows.map((r) => r.store_id), lat, lng }, a);
  return stores.map((s) => ({ ...s, notify: notify.get(s.id) ?? true }));
}

// ---------------- 점주: 매장 관리 ----------------

export interface StoreInput {
  name: string;
  category: string;
  description?: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string | null;
  priceLevel?: number;
  businessHours: BusinessHours;
  autoApprove?: boolean;
  imageUrls?: string[];
}

function validateStoreInput(i: StoreInput): string[] {
  const e: string[] = [];
  if (!i.name?.trim() || i.name.length > 40) e.push('매장명은 1~40자로 입력해 주세요.');
  if (!CATEGORIES.includes(i.category)) e.push('음식 종류를 선택해 주세요.');
  if (!i.address?.trim()) e.push('주소를 입력해 주세요.');
  if (!Number.isFinite(i.lat) || !Number.isFinite(i.lng) || i.lat < 33 || i.lat > 39 || i.lng < 124 || i.lng > 132) {
    e.push('매장 위치(위도·경도)가 국내 범위를 벗어났어요.');
  }
  if (i.priceLevel !== undefined && ![1, 2, 3].includes(i.priceLevel)) e.push('가격대가 올바르지 않아요.');
  if (!Array.isArray(i.businessHours) || i.businessHours.length !== 7) {
    e.push('요일별 영업시간 7개를 입력해 주세요.');
  } else {
    for (const d of i.businessHours) {
      if (d === null) continue;
      if (!isValidHHMM(d.open) || !isValidHHMM(d.close) || parseHHMM(d.open) >= parseHHMM(d.close)) {
        e.push('영업시간 형식이 올바르지 않아요. (예: 11:00 ~ 21:00)');
        break;
      }
    }
  }
  for (const u of i.imageUrls ?? []) {
    if (!/^https:\/\/[^\s]+$/.test(u)) {
      e.push('사진 주소는 https:// 로 시작해야 해요.');
      break;
    }
  }
  return e;
}

export async function createStore(
  ctx: Ctx,
  actor: Actor | null,
  input: StoreInput & { businessNumber: string; representativeName: string },
) {
  const a = requireRole(actor, 'owner');
  const errors = validateStoreInput(input);
  if (!isValidBusinessNumber(input.businessNumber ?? '')) errors.push('사업자등록번호 형식이 올바르지 않아요.');
  if (!input.representativeName?.trim()) errors.push('대표자명을 입력해 주세요.');
  if (errors.length) throw validation(errors[0]!, errors);

  return ctx.db.tx(async (q) => {
    const regionId = await ensureRegionForPoint(q, input.lat, input.lng, input.address.split(' ').slice(0, 3).join(' '));
    const [s] = await q.query<{ id: string }>(
      `insert into stores (name, category, description, address, lat, lng, phone, region_id, price_level, business_hours, auto_approve)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [input.name.trim(), input.category, input.description ?? '', input.address.trim(), input.lat, input.lng, input.phone ?? null,
        regionId, input.priceLevel ?? 2, JSON.stringify(input.businessHours), input.autoApprove ?? true],
    );
    const storeId = s!.id;
    await q.query(`insert into store_owners (store_id, user_id) values ($1, $2)`, [storeId, a.userId]);
    await q.query(
      `insert into store_business_verifications (store_id, business_number, representative_name) values ($1, $2, $3)`,
      [storeId, input.businessNumber.replace(/-/g, ''), input.representativeName.trim()],
    );
    for (const [i, url] of (input.imageUrls ?? []).entries()) {
      await q.query(`insert into store_images (store_id, url, sort_order) values ($1, $2, $3)`, [storeId, url, i]);
    }
    await audit(q, a, 'STORE_CREATE', 'store', storeId);
    return { id: storeId, status: 'PENDING' as const };
  });
}

export async function updateStore(ctx: Ctx, actor: Actor | null, storeId: string, input: Partial<StoreInput>) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const cur = await getStoreRow(ctx.db, storeId);
  const merged: StoreInput = {
    name: input.name ?? cur.name,
    category: input.category ?? cur.category,
    description: input.description ?? cur.description,
    address: input.address ?? cur.address,
    lat: input.lat ?? cur.lat,
    lng: input.lng ?? cur.lng,
    phone: input.phone !== undefined ? input.phone : cur.phone,
    priceLevel: input.priceLevel ?? cur.price_level,
    businessHours: input.businessHours ?? cur.business_hours,
    autoApprove: input.autoApprove ?? cur.auto_approve,
    imageUrls: input.imageUrls,
  };
  const errors = validateStoreInput(merged);
  if (errors.length) throw validation(errors[0]!, errors);
  await ctx.db.tx(async (q) => {
    const regionId = merged.lat !== cur.lat || merged.lng !== cur.lng ? await ensureRegionForPoint(q, merged.lat, merged.lng, merged.address) : cur.region_id;
    await q.query(
      `update stores set name = $2, category = $3, description = $4, address = $5, lat = $6, lng = $7, phone = $8,
              price_level = $9, business_hours = $10, auto_approve = $11, region_id = $12, updated_at = now() where id = $1`,
      [storeId, merged.name.trim(), merged.category, merged.description, merged.address.trim(), merged.lat, merged.lng, merged.phone,
        merged.priceLevel, JSON.stringify(merged.businessHours), merged.autoApprove, regionId],
    );
    if (input.imageUrls) {
      await q.query(`delete from store_images where store_id = $1`, [storeId]);
      for (const [i, url] of input.imageUrls.entries()) {
        await q.query(`insert into store_images (store_id, url, sort_order) values ($1, $2, $3)`, [storeId, url, i]);
      }
    }
    await audit(q, a, 'STORE_UPDATE', 'store', storeId, { fields: Object.keys(input) });
  });
  return getOwnerStore(ctx, a, storeId);
}

export async function listOwnerStores(ctx: Ctx, actor: Actor | null) {
  const a = requireRole(actor, 'owner');
  return ctx.db.query(
    `select s.id, s.name, s.status, s.status_note as "statusNote", s.operation_paused as "operationPaused", s.is_sample as "isSample"
       from stores s join store_owners o on o.store_id = s.id where o.user_id = $1 order by s.created_at`,
    [a.userId],
  );
}

export async function getOwnerStore(ctx: Ctx, actor: Actor | null, storeId: string) {
  await assertOwner(ctx.db, actor, storeId);
  const s = await getStoreRow(ctx.db, storeId);
  const now = ctx.now();
  const [region] = await ctx.db.query<RegionRow>(`select * from weather_regions where id = $1`, [s.region_id]);
  const menus = await ctx.db.query<MenuRow>(`select * from menus where store_id = $1 order by sort_order, name`, [storeId]);
  const images = await ctx.db.query<{ url: string }>(`select url from store_images where store_id = $1 order by sort_order`, [storeId]);
  const [verification] = await ctx.db.query(
    `select status, note, created_at as "createdAt" from store_business_verifications where store_id = $1 order by created_at desc limit 1`,
    [storeId],
  );
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    phone: s.phone,
    priceLevel: s.price_level,
    businessHours: s.business_hours,
    autoApprove: s.auto_approve,
    status: s.status,
    statusNote: s.status_note,
    operationPaused: s.operation_paused,
    reopenConfirmedAt: s.reopen_confirmed_at,
    isSample: s.is_sample,
    images: images.map((i) => i.url),
    menus: menus.map(menuView),
    verification: verification ?? null,
    region: regionView(region!, now),
  };
}

export async function setOperationPaused(ctx: Ctx, actor: Actor | null, storeId: string, paused: boolean) {
  const a = await assertOwner(ctx.db, actor, storeId);
  await ctx.db.query(`update stores set operation_paused = $2, updated_at = now() where id = $1`, [storeId, paused]);
  await audit(ctx.db, a, paused ? 'STORE_PAUSE' : 'STORE_RESUME', 'store', storeId);
}

/** 태풍 이후 점주의 영업 재개 확인 → 회복 특가 오픈, 즐겨찾기 고객 알림 */
export async function confirmReopen(ctx: Ctx, actor: Actor | null, storeId: string) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const s = await getStoreRow(ctx.db, storeId);
  const [r] = await ctx.db.query<RegionRow>(`select * from weather_regions where id = $1`, [s.region_id]);
  if (r!.safety_state !== 'RECOVERY') throw badRequest('태풍 회복 단계에서만 영업 재개를 확인할 수 있어요.');
  const now = ctx.now();
  await ctx.db.tx(async (q) => {
    await q.query(`update stores set reopen_confirmed_at = $2, operation_paused = false, updated_at = $2 where id = $1`, [storeId, now]);
    await audit(q, a, 'STORE_REOPEN_CONFIRM', 'store', storeId);
    const hasRecovery = await q.query(
      `select 1 from discount_campaigns where store_id = $1 and kind = 'TYPHOON_RECOVERY' and status = 'APPROVED' and not paused and valid_until > $2`,
      [storeId, now],
    );
    if (hasRecovery.length) {
      const fans = await q.query<{ user_id: string }>(`select user_id from favorites where store_id = $1 and notify`, [storeId]);
      for (const f of fans) {
        await enqueueNotification(q, now, {
          userId: f.user_id,
          type: 'TYPHOON_RECOVERY_OPEN',
          category: 'typhoon',
          title: `${s.name} 영업 재개! 회복 특가 오픈 🐸`,
          body: '태풍이 지나갔어요. 동네 가게를 응원하러 가 볼까요?',
          data: { storeId },
          dedupeKey: `recovery:${storeId}:${now.toISOString().slice(0, 10)}`,
        });
      }
    }
  });
}

// ---------------- 점주: 메뉴 ----------------

export interface MenuInput {
  name: string;
  description?: string;
  price: number;
  isSet?: boolean;
  isAvailable?: boolean;
  sortOrder?: number;
}

function validateMenu(m: MenuInput) {
  if (!m.name?.trim() || m.name.length > 40) throw validation('메뉴명은 1~40자로 입력해 주세요.');
  if (!Number.isInteger(m.price) || m.price <= 0 || m.price > 10_000_000) throw validation('가격은 1원 이상 정수로 입력해 주세요.');
}

export async function createMenu(ctx: Ctx, actor: Actor | null, storeId: string, m: MenuInput) {
  const a = await assertOwner(ctx.db, actor, storeId);
  validateMenu(m);
  const [r] = await ctx.db.query<MenuRow>(
    `insert into menus (store_id, name, description, price, is_set, is_available, sort_order)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [storeId, m.name.trim(), m.description ?? '', m.price, !!m.isSet, m.isAvailable ?? true, m.sortOrder ?? 0],
  );
  await audit(ctx.db, a, 'MENU_CREATE', 'menu', r!.id, { storeId });
  return menuView(r!);
}

/** 메뉴 가격을 바꿔도 이미 확정된 예약은 reservation_items 스냅샷이라 영향 없음 */
export async function updateMenu(ctx: Ctx, actor: Actor | null, storeId: string, menuId: string, m: Partial<MenuInput>) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const [cur] = await ctx.db.query<MenuRow>(`select * from menus where id = $1 and store_id = $2`, [menuId, storeId]);
  if (!cur) throw notFound('메뉴를 찾을 수 없어요.');
  const next: MenuInput = {
    name: m.name ?? cur.name,
    description: m.description ?? cur.description,
    price: m.price ?? cur.price,
    isSet: m.isSet ?? cur.is_set,
    isAvailable: m.isAvailable ?? cur.is_available,
    sortOrder: m.sortOrder ?? cur.sort_order,
  };
  validateMenu(next);
  const [r] = await ctx.db.query<MenuRow>(
    `update menus set name = $3, description = $4, price = $5, is_set = $6, is_available = $7, sort_order = $8, updated_at = now()
      where id = $1 and store_id = $2 returning *`,
    [menuId, storeId, next.name.trim(), next.description, next.price, next.isSet, next.isAvailable, next.sortOrder],
  );
  await audit(ctx.db, a, 'MENU_UPDATE', 'menu', menuId, { storeId, fields: Object.keys(m) });
  return menuView(r!);
}

export async function deleteMenu(ctx: Ctx, actor: Actor | null, storeId: string, menuId: string) {
  const a = await assertOwner(ctx.db, actor, storeId);
  // 과거 예약에 쓰인 메뉴도 reservation_items 에 이름·가격 스냅샷이 남으므로 삭제 가능
  const r = await ctx.db.query(`delete from menus where id = $1 and store_id = $2 returning id`, [menuId, storeId]);
  if (!r.length) throw notFound('메뉴를 찾을 수 없어요.');
  await audit(ctx.db, a, 'MENU_DELETE', 'menu', menuId, { storeId });
}

// ---------------- 점주: 예약 가능 시간(슬롯) ----------------

export async function listOwnerSlots(ctx: Ctx, actor: Actor | null, storeId: string, from: Date, days = 7) {
  await assertOwner(ctx.db, actor, storeId);
  const rows = await ctx.db.query<SlotRow>(
    `select * from reservation_slots where store_id = $1 and start_at >= $2 and start_at < $3 order by start_at`,
    [storeId, from, new Date(from.getTime() + days * 86400_000)],
  );
  return rows.map((r) => ({ id: r.id, startAt: r.start_at, durationMinutes: r.duration_minutes, capacity: r.capacity, booked: r.booked, closed: r.closed }));
}

/** 날짜 × 시간 조합으로 슬롯 일괄 생성. 영업시간 밖은 건너뛰고, 이미 있으면 정원만 갱신(예약 수보다 작게는 불가) */
export async function generateSlots(
  ctx: Ctx,
  actor: Actor | null,
  storeId: string,
  input: { dates: string[]; times: string[]; capacity: number; durationMinutes?: number },
) {
  const a = await assertOwner(ctx.db, actor, storeId);
  const s = await getStoreRow(ctx.db, storeId);
  const duration = input.durationMinutes ?? 60;
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 200) throw validation('정원은 1~200 사이로 입력해 주세요.');
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) throw validation('이용 시간은 15~240분이에요.');
  if (!input.dates?.length || input.dates.length > 31) throw validation('날짜를 1~31개 선택해 주세요.');
  if (!input.times?.length || input.times.length > 48) throw validation('시간을 1개 이상 선택해 주세요.');
  const now = ctx.now();
  let created = 0;
  let skipped = 0;
  await ctx.db.tx(async (q) => {
    for (const d of input.dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw validation(`날짜 형식 오류: ${d}`);
      for (const t of input.times) {
        if (!isValidHHMM(t)) throw validation(`시간 형식 오류: ${t}`);
        const start = kstDateTime(d, t);
        if (start <= now || !isWithinBusinessHours(s.business_hours, start, duration)) {
          skipped++;
          continue;
        }
        await q.query(
          `insert into reservation_slots (store_id, start_at, duration_minutes, capacity) values ($1, $2, $3, $4)
           on conflict (store_id, start_at) do update set capacity = greatest(excluded.capacity, reservation_slots.booked),
             duration_minutes = excluded.duration_minutes, closed = false, updated_at = now()`,
          [storeId, start, duration, input.capacity],
        );
        created++;
      }
    }
    await audit(q, a, 'SLOTS_GENERATE', 'store', storeId, { dates: input.dates.length, times: input.times.length, created, skipped });
  });
  return { created, skipped };
}

export async function setSlotClosed(ctx: Ctx, actor: Actor | null, storeId: string, slotId: string, closed: boolean) {
  await assertOwner(ctx.db, actor, storeId);
  const r = await ctx.db.query(`update reservation_slots set closed = $3, updated_at = now() where id = $1 and store_id = $2 returning id`, [
    slotId,
    storeId,
    closed,
  ]);
  if (!r.length) throw notFound('예약 시간을 찾을 수 없어요.');
}

// ---------------- 관리자 ----------------

export async function adminListStores(ctx: Ctx, actor: Actor | null, status?: string) {
  requireRole(actor, 'admin');
  const params: unknown[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'where s.status = $1';
  }
  const rows = await ctx.db.query<
    StoreRow & { owner_email: string | null; business_number: string | null; representative_name: string | null; region_name: string }
  >(
    `select s.*, r.name as region_name,
            (select u.email from store_owners o join users u on u.id = o.user_id where o.store_id = s.id limit 1) as owner_email,
            v.business_number, v.representative_name
       from stores s join weather_regions r on r.id = s.region_id
       left join lateral (select business_number, representative_name from store_business_verifications
                           where store_id = s.id order by created_at desc limit 1) v on true
       ${where} order by s.created_at desc`,
    params,
  );
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    category: CATEGORY_LABEL[s.category] ?? s.category,
    address: s.address,
    regionName: s.region_name,
    status: s.status,
    statusNote: s.status_note,
    isSample: s.is_sample,
    operationPaused: s.operation_paused,
    ownerEmail: s.owner_email ? maskEmail(s.owner_email) : null,
    businessNumber: s.business_number ? `${s.business_number.slice(0, 3)}-${s.business_number.slice(3, 5)}-*****` : null,
    representativeName: s.representative_name,
    createdAt: s.created_at,
  }));
}

export async function adminReviewStore(
  ctx: Ctx,
  actor: Actor | null,
  storeId: string,
  decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'RESTORE',
  note?: string,
) {
  const a = requireRole(actor, 'admin');
  const s = await getStoreRow(ctx.db, storeId);
  const next = { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', RESTORE: 'APPROVED' }[decision];
  if (!next) throw validation('알 수 없는 처리예요.');
  if ((decision === 'REJECT' || decision === 'SUSPEND') && !note?.trim()) throw validation('사유를 입력해 주세요.');
  const now = ctx.now();
  await ctx.db.tx(async (q) => {
    await q.query(
      `update stores set status = $2, status_note = $3, approved_at = case when $2 = 'APPROVED' then $4 else approved_at end,
              approved_by = case when $2 = 'APPROVED' then $5::uuid else approved_by end, updated_at = $4 where id = $1`,
      [storeId, next, note ?? null, now, a.userId],
    );
    if (decision === 'APPROVE' || decision === 'REJECT') {
      await q.query(
        `update store_business_verifications set status = $2, reviewed_by = $3, reviewed_at = $4, note = $5
          where store_id = $1 and status = 'SUBMITTED'`,
        [storeId, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', a.userId, now, note ?? null],
      );
    }
    await audit(q, a, `STORE_${decision}`, 'store', storeId, { from: s.status, to: next, note });
    const owners = await q.query<{ user_id: string }>(`select user_id from store_owners where store_id = $1`, [storeId]);
    for (const o of owners) {
      await enqueueNotification(q, now, {
        userId: o.user_id,
        type: `STORE_${decision}`,
        category: 'owner',
        title: decision === 'APPROVE' || decision === 'RESTORE' ? '매장이 승인됐어요 🎉' : '매장 상태가 변경됐어요',
        body: decision === 'APPROVE' || decision === 'RESTORE' ? `${s.name}이(가) 청개구리에 노출돼요.` : `${s.name}: ${note}`,
        data: { storeId },
      });
    }
  });
}
