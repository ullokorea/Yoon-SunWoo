// 할인 정책 엔진: 캠페인 입력 검증, 예약 가능 여부 판정, 서버측 가격 계산

import { HOUR, MINUTE, isValidHHMM, kstDate, kstMinutesOfDay, kstWeekday, parseHHMM } from './time';
import type {
  BusinessHours,
  Campaign,
  CampaignKind,
  Menu,
  RegionWeatherState,
  Slot,
  StoreForBooking,
} from './types';

export const RATE_LIMITS: Record<CampaignKind, { min: number; max: number }> = {
  RAIN: { min: 10, max: 30 },
  TYPHOON_PRE: { min: 10, max: 50 },
  TYPHOON_RECOVERY: { min: 10, max: 50 },
};

export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = {
  RAIN: '우천 할인',
  TYPHOON_PRE: '태풍 특가 (사전 예약)',
  TYPHOON_RECOVERY: '태풍 회복 특가',
};

/** 태풍 영향 예상 시각 기준, 이 시간 이전에 끝나는 슬롯만 태풍 전 방문으로 허용 */
export const TYPHOON_SAFE_MARGIN_MS = 6 * HOUR;
/** 태풍 이후 방문 사전 예약은 예상 종료 + 이 시간 이후 슬롯만 허용 */
export const TYPHOON_POST_MARGIN_MS = 24 * HOUR;
/** 예약 마감: 슬롯 시작 이 시간 전까지만 신규 예약 */
export const BOOKING_LEAD_MS = 10 * MINUTE;

export interface CampaignInput {
  kind: CampaignKind;
  title: string;
  rate: number;
  scope: 'ALL' | 'MENUS';
  menuIds: string[];
  dailyStartTime: string;
  dailyEndTime: string;
  validFrom: Date;
  validUntil: Date;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  maxPartySize: number;
  dailyLimit: number | null;
}

/** 점주가 입력한 캠페인 값 검증. 오류 메시지 배열 반환 (빈 배열 = 유효) */
export function validateCampaignInput(input: CampaignInput, storeMenuIds: string[]): string[] {
  const errors: string[] = [];
  const limits = RATE_LIMITS[input.kind];
  if (!limits) {
    errors.push('알 수 없는 할인 유형입니다.');
    return errors;
  }
  if (!Number.isInteger(input.rate) || input.rate < limits.min || input.rate > limits.max) {
    errors.push(`${CAMPAIGN_KIND_LABEL[input.kind]} 할인율은 ${limits.min}~${limits.max}% 사이 정수여야 합니다.`);
  }
  if (!input.title.trim() || input.title.length > 60) errors.push('캠페인 이름은 1~60자로 입력해 주세요.');
  if (!isValidHHMM(input.dailyStartTime) || !isValidHHMM(input.dailyEndTime)) {
    errors.push('적용 시간 형식은 HH:MM 이어야 합니다.');
  } else if (parseHHMM(input.dailyStartTime) >= parseHHMM(input.dailyEndTime)) {
    errors.push('적용 종료 시간은 시작 시간보다 늦어야 합니다.');
  }
  if (!(input.validFrom instanceof Date) || Number.isNaN(input.validFrom.getTime())) errors.push('시작일이 올바르지 않습니다.');
  if (!(input.validUntil instanceof Date) || Number.isNaN(input.validUntil.getTime())) errors.push('종료일이 올바르지 않습니다.');
  if (input.validUntil <= input.validFrom) errors.push('할인 종료일은 시작일보다 늦어야 합니다.');
  if (input.maxDiscountAmount !== null && (!Number.isInteger(input.maxDiscountAmount) || input.maxDiscountAmount <= 0)) {
    errors.push('최대 할인 금액은 양의 정수여야 합니다.');
  }
  if (!Number.isInteger(input.minOrderAmount) || input.minOrderAmount < 0) errors.push('최소 주문 금액은 0 이상 정수여야 합니다.');
  if (!Number.isInteger(input.maxPartySize) || input.maxPartySize < 1 || input.maxPartySize > 20) {
    errors.push('예약 가능 인원은 1~20명이어야 합니다.');
  }
  if (input.dailyLimit !== null && (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1)) {
    errors.push('하루 최대 예약 건수는 1 이상이어야 합니다.');
  }
  if (input.scope === 'MENUS') {
    if (input.menuIds.length === 0) errors.push('할인 적용 메뉴를 1개 이상 선택해 주세요.');
    const own = new Set(storeMenuIds);
    if (input.menuIds.some((id) => !own.has(id))) errors.push('다른 매장의 메뉴는 선택할 수 없습니다.');
  }
  return errors;
}

/** 신규 캠페인의 초기 검수 상태: 태풍 특가는 관리자 검수 필요 */
export function initialCampaignStatus(kind: CampaignKind): 'APPROVED' | 'PENDING_REVIEW' {
  return kind === 'RAIN' ? 'APPROVED' : 'PENDING_REVIEW';
}

export function isWithinBusinessHours(hours: BusinessHours, startAt: Date, durationMinutes: number): boolean {
  const day = hours[kstWeekday(startAt)];
  if (!day) return false;
  const start = kstMinutesOfDay(startAt);
  const end = start + durationMinutes;
  return start >= parseHHMM(day.open) && end <= parseHHMM(day.close);
}

export type BookingBlockCode =
  | 'STORE_UNAVAILABLE'
  | 'STORE_PAUSED'
  | 'SAFETY_DANGER'
  | 'WEATHER_UNKNOWN'
  | 'NOT_RAINING'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_TOO_SOON'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'DISCOUNT_INACTIVE'
  | 'DISCOUNT_ENDED'
  | 'OUTSIDE_DISCOUNT_HOURS'
  | 'TYPHOON_UNSAFE_TIME'
  | 'STORE_NOT_REOPENED'
  | 'PARTY_TOO_LARGE'
  | 'SLOT_FULL';

export type Eligibility = { ok: true } | { ok: false; code: BookingBlockCode; message: string };

const block = (code: BookingBlockCode, message: string): Eligibility => ({ ok: false, code, message });

export interface EligibilityInput {
  region: Pick<RegionWeatherState, 'rain' | 'safety' | 'safetySince' | 'typhoon'>;
  store: StoreForBooking;
  campaign: Campaign;
  slot: Slot;
  partySize: number;
  now: Date;
}

/**
 * 이 캠페인으로 이 슬롯을 지금 예약할 수 있는가.
 * 안전 조건을 가장 먼저 본다 — 위험·불확실하면 무조건 차단.
 */
export function checkBookingEligibility(i: EligibilityInput): Eligibility {
  const { region, store, campaign: c, slot, now } = i;

  if (region.safety === 'DANGER') return block('SAFETY_DANGER', '기상특보 발효 중이라 신규 방문 예약을 받을 수 없어요.');
  if (region.safety === 'UNKNOWN') return block('WEATHER_UNKNOWN', '기상 정보를 확인할 수 없어 안전을 위해 예약을 잠시 멈췄어요.');
  if (store.status !== 'APPROVED') return block('STORE_UNAVAILABLE', '현재 예약을 받지 않는 매장이에요.');
  if (store.operationPaused) return block('STORE_PAUSED', '매장이 잠시 영업을 중단했어요.');

  if (slot.storeId !== store.id || slot.closed) return block('SLOT_UNAVAILABLE', '선택한 시간은 예약할 수 없어요.');
  if (slot.startAt.getTime() - now.getTime() < BOOKING_LEAD_MS) {
    return block('SLOT_TOO_SOON', '방문 10분 전까지만 예약할 수 있어요.');
  }
  if (!isWithinBusinessHours(store.businessHours, slot.startAt, slot.durationMinutes)) {
    return block('OUTSIDE_BUSINESS_HOURS', '영업시간 외 시간은 예약할 수 없어요.');
  }
  if (i.partySize < 1 || i.partySize > c.maxPartySize) {
    return block('PARTY_TOO_LARGE', `이 할인은 최대 ${c.maxPartySize}명까지 예약할 수 있어요.`);
  }
  if (slot.booked + i.partySize > slot.capacity) return block('SLOT_FULL', '선택한 시간의 예약이 마감됐어요.');

  if (c.storeId !== store.id || c.status !== 'APPROVED' || c.paused) {
    return block('DISCOUNT_INACTIVE', '지금은 진행 중인 할인이 아니에요.');
  }
  if (now >= c.validUntil || slot.startAt >= c.validUntil || slot.startAt < c.validFrom) {
    return block('DISCOUNT_ENDED', '할인 기간이 끝났거나 해당 시간에는 적용되지 않아요.');
  }
  const slotMin = kstMinutesOfDay(slot.startAt);
  if (slotMin < parseHHMM(c.dailyStartTime) || slotMin >= parseHHMM(c.dailyEndTime)) {
    return block('OUTSIDE_DISCOUNT_HOURS', `할인은 ${c.dailyStartTime}~${c.dailyEndTime} 방문에만 적용돼요.`);
  }

  switch (c.kind) {
    case 'RAIN': {
      if (region.rain !== 'RAINING') return block('NOT_RAINING', '비가 오는 동안에만 우천 할인을 예약할 수 있어요.');
      if (kstDate(slot.startAt) !== kstDate(now)) return block('DISCOUNT_ENDED', '우천 할인은 오늘 방문만 예약할 수 있어요.');
      if (region.safety === 'TYPHOON_WATCH' && !beforeTyphoonCutoff(region.typhoon, slot)) {
        return block('TYPHOON_UNSAFE_TIME', '태풍 영향이 예상되는 시간대라 예약할 수 없어요.');
      }
      return { ok: true };
    }
    case 'TYPHOON_PRE': {
      if (region.safety !== 'TYPHOON_WATCH') return block('DISCOUNT_INACTIVE', '태풍 접근 예보 단계에서만 예약할 수 있어요.');
      if (!beforeTyphoonCutoff(region.typhoon, slot)) {
        return block('TYPHOON_UNSAFE_TIME', '태풍 영향 예상 6시간 전까지 끝나는 시간대만 예약할 수 있어요.');
      }
      return { ok: true };
    }
    case 'TYPHOON_RECOVERY': {
      if (region.safety === 'RECOVERY') {
        if (!store.reopenConfirmedAt || store.reopenConfirmedAt < region.safetySince) {
          return block('STORE_NOT_REOPENED', '매장이 아직 영업 재개를 확인하지 않았어요.');
        }
        return { ok: true };
      }
      if (region.safety === 'TYPHOON_WATCH') {
        // 태풍 이후 방문 사전 예약: 예상 종료 + 24시간 이후 슬롯만
        if (!region.typhoon) return block('TYPHOON_UNSAFE_TIME', '태풍 종료 예상 시각을 알 수 없어 예약할 수 없어요.');
        const earliest = region.typhoon.expectedClearAt.getTime() + TYPHOON_POST_MARGIN_MS;
        if (slot.startAt.getTime() < earliest) {
          return block('TYPHOON_UNSAFE_TIME', '태풍이 지나간 다음 날 이후 방문만 미리 예약할 수 있어요.');
        }
        return { ok: true };
      }
      return block('DISCOUNT_INACTIVE', '태풍 회복 특가 기간이 아니에요.');
    }
  }
}

function beforeTyphoonCutoff(typhoon: RegionWeatherState['typhoon'], slot: Slot): boolean {
  if (!typhoon) return false; // 영향 시각 불명 → 보수적으로 차단
  const slotEnd = slot.startAt.getTime() + slot.durationMinutes * MINUTE;
  return slotEnd <= typhoon.expectedImpactAt.getTime() - TYPHOON_SAFE_MARGIN_MS;
}

/** 캠페인이 지금 소비자에게 '진행 중'으로 노출될 수 있는가 (목록 표시용 — 슬롯과 무관) */
export function isCampaignLive(c: Campaign, region: Pick<RegionWeatherState, 'rain' | 'safety'>, now: Date): boolean {
  if (c.status !== 'APPROVED' || c.paused || now >= c.validUntil) return false;
  if (region.safety === 'DANGER' || region.safety === 'UNKNOWN') return false;
  switch (c.kind) {
    case 'RAIN':
      return region.rain === 'RAINING' && c.autoActivate;
    case 'TYPHOON_PRE':
      return region.safety === 'TYPHOON_WATCH';
    case 'TYPHOON_RECOVERY':
      return region.safety === 'RECOVERY' || region.safety === 'TYPHOON_WATCH';
  }
}

// ---------------- 가격 계산 ----------------

export interface PriceLine {
  menuId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  lineSubtotal: number;
  lineDiscount: number;
}

export interface PriceQuote {
  lines: PriceLine[];
  subtotal: number;
  discount: number;
  total: number;
  discountCapped: boolean;
  appliedRate: number;
}

export class PricingError extends Error {
  constructor(
    public code: 'NO_ITEMS' | 'INVALID_MENU' | 'INVALID_QUANTITY' | 'MIN_ORDER' | 'NO_ELIGIBLE_ITEM',
    message: string,
  ) {
    super(message);
  }
}

/**
 * 서버측 가격 계산. 클라이언트가 보낸 가격은 받지 않는다 — 메뉴 ID와 수량만 받는다.
 * 메뉴별 할인액은 원 단위 내림. 최대 할인 금액 상한 적용.
 */
export function quotePrice(
  campaign: Pick<Campaign, 'rate' | 'scope' | 'menuIds' | 'maxDiscountAmount' | 'minOrderAmount' | 'storeId'>,
  menus: Menu[],
  items: Array<{ menuId: string; quantity: number }>,
): PriceQuote {
  if (items.length === 0) throw new PricingError('NO_ITEMS', '메뉴를 1개 이상 선택해 주세요.');
  const byId = new Map(menus.map((m) => [m.id, m]));
  const eligible = new Set(campaign.scope === 'ALL' ? menus.map((m) => m.id) : campaign.menuIds);
  const merged = new Map<string, number>();
  for (const it of items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 50) {
      throw new PricingError('INVALID_QUANTITY', '수량이 올바르지 않아요.');
    }
    merged.set(it.menuId, (merged.get(it.menuId) ?? 0) + it.quantity);
  }

  const lines: PriceLine[] = [];
  for (const [menuId, quantity] of merged) {
    const m = byId.get(menuId);
    if (!m || m.storeId !== campaign.storeId || !m.isAvailable) {
      throw new PricingError('INVALID_MENU', '주문할 수 없는 메뉴가 포함되어 있어요.');
    }
    const rate = eligible.has(menuId) ? campaign.rate : 0;
    const lineSubtotal = m.price * quantity;
    lines.push({
      menuId,
      name: m.name,
      quantity,
      unitPrice: m.price,
      discountRate: rate,
      lineSubtotal,
      lineDiscount: Math.floor((lineSubtotal * rate) / 100),
    });
  }
  if (!lines.some((l) => l.discountRate > 0)) {
    throw new PricingError('NO_ELIGIBLE_ITEM', '할인 적용 메뉴를 1개 이상 선택해 주세요.');
  }
  const subtotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);
  if (subtotal < campaign.minOrderAmount) {
    throw new PricingError('MIN_ORDER', `최소 주문 금액은 ${campaign.minOrderAmount.toLocaleString('ko-KR')}원이에요.`);
  }
  let discount = lines.reduce((s, l) => s + l.lineDiscount, 0);
  let capped = false;
  if (campaign.maxDiscountAmount !== null && discount > campaign.maxDiscountAmount) {
    discount = campaign.maxDiscountAmount;
    capped = true;
  }
  return { lines, subtotal, discount, total: subtotal - discount, discountCapped: capped, appliedRate: campaign.rate };
}
