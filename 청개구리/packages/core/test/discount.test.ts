import { describe, expect, it } from 'vitest';
import {
  checkBookingEligibility,
  initialRegionState,
  kstDateTime,
  quotePrice,
  PricingError,
  validateCampaignInput,
  checkTransition,
  isValidBusinessNumber,
  toKmaGrid,
  distanceMeters,
  type Campaign,
  type CampaignInput,
  type Menu,
  type RegionWeatherState,
  type Slot,
  type StoreForBooking,
} from '../src';

const now = kstDateTime('2026-07-10', '12:00');
const hours = Array(7).fill({ open: '11:00', close: '22:00' });

const store: StoreForBooking = {
  id: 's1',
  status: 'APPROVED',
  operationPaused: false,
  reopenConfirmedAt: null,
  businessHours: hours,
  autoApprove: true,
};

const raining: RegionWeatherState = { ...initialRegionState(now), rain: 'RAINING', safety: 'NORMAL', lastSnapshotAt: now };

const rain: Campaign = {
  id: 'c1',
  storeId: 's1',
  kind: 'RAIN',
  title: '비 오는 날 20%',
  rate: 20,
  scope: 'ALL',
  menuIds: [],
  dailyStartTime: '11:00',
  dailyEndTime: '21:00',
  validFrom: kstDateTime('2026-07-01', '00:00'),
  validUntil: kstDateTime('2026-08-01', '00:00'),
  maxDiscountAmount: null,
  minOrderAmount: 0,
  maxPartySize: 4,
  dailyLimit: null,
  autoActivate: true,
  paused: false,
  status: 'APPROVED',
};

const slotAt = (date: string, time: string, over: Partial<Slot> = {}): Slot => ({
  id: 'slot',
  storeId: 's1',
  startAt: kstDateTime(date, time),
  durationMinutes: 60,
  capacity: 10,
  booked: 0,
  closed: false,
  ...over,
});

const check = (over: Partial<Parameters<typeof checkBookingEligibility>[0]>) =>
  checkBookingEligibility({ region: raining, store, campaign: rain, slot: slotAt('2026-07-10', '18:00'), partySize: 2, now, ...over });

describe('예약 가능 판정 — 우천 할인', () => {
  it('비 오는 날 오늘 할인 시간 내 슬롯은 예약 가능', () => {
    expect(check({})).toEqual({ ok: true });
  });
  it('맑은 날에는 우천 할인 예약 불가', () => {
    const r = check({ region: { ...raining, rain: 'CLEAR' } });
    expect(r.ok === false && r.code).toBe('NOT_RAINING');
  });
  it('비 예보 단계에서도 불가', () => {
    const r = check({ region: { ...raining, rain: 'FORECAST' } });
    expect(r.ok === false && r.code).toBe('NOT_RAINING');
  });
  it('내일 슬롯은 불가', () => {
    const r = check({ slot: slotAt('2026-07-11', '18:00') });
    expect(r.ok === false && r.code).toBe('DISCOUNT_ENDED');
  });
  it('할인 적용 시간 밖 슬롯 불가', () => {
    const r = check({ slot: slotAt('2026-07-10', '21:00') });
    expect(r.ok === false && r.code).toBe('OUTSIDE_DISCOUNT_HOURS');
  });
  it('영업시간 밖 슬롯 불가', () => {
    const r = check({ slot: slotAt('2026-07-10', '21:30', { durationMinutes: 60 }), campaign: { ...rain, dailyEndTime: '23:00' } });
    expect(r.ok === false && r.code).toBe('OUTSIDE_BUSINESS_HOURS');
  });
  it('휴무일 불가', () => {
    const closedHours = [...hours];
    closedHours[5] = null; // 2026-07-10 은 금요일
    const r = check({ store: { ...store, businessHours: closedHours } });
    expect(r.ok === false && r.code).toBe('OUTSIDE_BUSINESS_HOURS');
  });
  it('할인 종료 직전: 종료 이후 시작 슬롯은 불가', () => {
    const r = check({ campaign: { ...rain, validUntil: kstDateTime('2026-07-10', '17:00') } });
    expect(r.ok === false && r.code).toBe('DISCOUNT_ENDED');
  });
  it('방문 10분 전 이후엔 예약 불가', () => {
    const r = check({ slot: slotAt('2026-07-10', '12:05') });
    expect(r.ok === false && r.code).toBe('SLOT_TOO_SOON');
  });
  it('수량 초과 불가', () => {
    const r = check({ slot: slotAt('2026-07-10', '18:00', { booked: 9 }) });
    expect(r.ok === false && r.code).toBe('SLOT_FULL');
  });
  it('인원 초과 불가', () => {
    const r = check({ partySize: 5 });
    expect(r.ok === false && r.code).toBe('PARTY_TOO_LARGE');
  });
  it('매장 영업 중단 시 불가', () => {
    const r = check({ store: { ...store, operationPaused: true } });
    expect(r.ok === false && r.code).toBe('STORE_PAUSED');
  });
  it('미승인 매장 불가', () => {
    const r = check({ store: { ...store, status: 'PENDING' } });
    expect(r.ok === false && r.code).toBe('STORE_UNAVAILABLE');
  });
  it('일시정지 캠페인 불가', () => {
    const r = check({ campaign: { ...rain, paused: true } });
    expect(r.ok === false && r.code).toBe('DISCOUNT_INACTIVE');
  });
});

describe('예약 가능 판정 — 안전', () => {
  it('DANGER 는 무조건 차단 (비가 와도)', () => {
    const r = check({ region: { ...raining, safety: 'DANGER' } });
    expect(r.ok === false && r.code).toBe('SAFETY_DANGER');
  });
  it('UNKNOWN 은 보수적으로 차단', () => {
    const r = check({ region: { ...raining, safety: 'UNKNOWN' } });
    expect(r.ok === false && r.code).toBe('WEATHER_UNKNOWN');
  });

  const typhoon = {
    name: '샘플',
    expectedImpactAt: kstDateTime('2026-07-11', '06:00'),
    expectedClearAt: kstDateTime('2026-07-11', '18:00'),
  };
  const watch: RegionWeatherState = { ...raining, rain: 'CLEAR', safety: 'TYPHOON_WATCH', typhoon };
  const pre: Campaign = { ...rain, id: 'c2', kind: 'TYPHOON_PRE', rate: 40, dailyEndTime: '22:00' };
  const recov: Campaign = { ...rain, id: 'c3', kind: 'TYPHOON_RECOVERY', rate: 50, dailyEndTime: '22:00' };

  it('태풍 사전 특가: 영향 6시간 전까지 끝나는 슬롯만', () => {
    expect(check({ region: watch, campaign: pre, slot: slotAt('2026-07-10', '18:00') }).ok).toBe(true);
    // 23:00 까지 → 07-11 00:00 이후 cutoff... 영향 06:00 - 6h = 00:00. 20:00~21:00 OK
    expect(check({ region: watch, campaign: pre, slot: slotAt('2026-07-10', '20:00') }).ok).toBe(true);
    const late = check({ region: watch, campaign: pre, slot: slotAt('2026-07-10', '21:30', { durationMinutes: 30 }) });
    expect(late.ok).toBe(true);
  });
  it('태풍 사전 특가: 영향 시각 정보가 없으면 차단', () => {
    const r = check({ region: { ...watch, typhoon: null }, campaign: pre });
    expect(r.ok === false && r.code).toBe('TYPHOON_UNSAFE_TIME');
  });
  it('태풍 사전 특가: cutoff 넘는 슬롯 차단', () => {
    const near = { ...typhoon, expectedImpactAt: kstDateTime('2026-07-10', '23:00') };
    const r = check({ region: { ...watch, typhoon: near }, campaign: pre, slot: slotAt('2026-07-10', '17:00') });
    expect(r.ok === false && r.code).toBe('TYPHOON_UNSAFE_TIME');
  });
  it('태풍 회복 특가 사전 예약: 종료 + 24시간 이후만', () => {
    const tooEarly = check({ region: watch, campaign: recov, slot: slotAt('2026-07-12', '12:00') });
    expect(tooEarly.ok === false && tooEarly.code).toBe('TYPHOON_UNSAFE_TIME');
    expect(check({ region: watch, campaign: recov, slot: slotAt('2026-07-12', '19:00') }).ok).toBe(true);
  });
  it('회복 단계: 점주 영업 재개 확인 전엔 불가', () => {
    const recovery = { ...raining, safety: 'RECOVERY' as const, safetySince: kstDateTime('2026-07-10', '09:00') };
    const r = check({ region: recovery, campaign: recov });
    expect(r.ok === false && r.code).toBe('STORE_NOT_REOPENED');
    const ok = check({
      region: recovery,
      campaign: recov,
      store: { ...store, reopenConfirmedAt: kstDateTime('2026-07-10', '10:00') },
    });
    expect(ok.ok).toBe(true);
  });
  it('태풍 사전 특가는 일반 날씨에선 불가', () => {
    const r = check({ campaign: pre });
    expect(r.ok === false && r.code).toBe('DISCOUNT_INACTIVE');
  });
});

describe('캠페인 입력 검증', () => {
  const base: CampaignInput = {
    kind: 'RAIN',
    title: '비 할인',
    rate: 20,
    scope: 'ALL',
    menuIds: [],
    dailyStartTime: '11:00',
    dailyEndTime: '21:00',
    validFrom: new Date('2026-07-01'),
    validUntil: new Date('2026-08-01'),
    maxDiscountAmount: null,
    minOrderAmount: 0,
    maxPartySize: 4,
    dailyLimit: 10,
  };
  it('정상 입력', () => expect(validateCampaignInput(base, [])).toEqual([]));
  it('우천 할인 31% 거부', () => expect(validateCampaignInput({ ...base, rate: 31 }, []).length).toBe(1));
  it('우천 할인 9% 거부', () => expect(validateCampaignInput({ ...base, rate: 9 }, []).length).toBe(1));
  it('태풍 특가 50% 허용, 51% 거부', () => {
    expect(validateCampaignInput({ ...base, kind: 'TYPHOON_PRE', rate: 50 }, [])).toEqual([]);
    expect(validateCampaignInput({ ...base, kind: 'TYPHOON_PRE', rate: 51 }, []).length).toBe(1);
  });
  it('다른 매장 메뉴 거부', () => {
    expect(validateCampaignInput({ ...base, scope: 'MENUS', menuIds: ['x'] }, ['m1']).length).toBe(1);
  });
  it('시간 역전 거부', () => {
    expect(validateCampaignInput({ ...base, dailyStartTime: '21:00', dailyEndTime: '11:00' }, []).length).toBe(1);
  });
});

describe('가격 계산 (서버측)', () => {
  const menus: Menu[] = [
    { id: 'm1', storeId: 's1', name: '칼국수', price: 9000, isSet: false, isAvailable: true },
    { id: 'm2', storeId: 's1', name: '파전', price: 15000, isSet: false, isAvailable: true },
    { id: 'm3', storeId: 's1', name: '품절메뉴', price: 5000, isSet: false, isAvailable: false },
    { id: 'x1', storeId: 's2', name: '남의메뉴', price: 1000, isSet: false, isAvailable: true },
  ];
  it('전체 메뉴 20% 할인', () => {
    const q = quotePrice(rain, menus, [{ menuId: 'm1', quantity: 2 }, { menuId: 'm2', quantity: 1 }]);
    expect(q.subtotal).toBe(33000);
    expect(q.discount).toBe(6600);
    expect(q.total).toBe(26400);
  });
  it('특정 메뉴만 할인', () => {
    const q = quotePrice({ ...rain, scope: 'MENUS', menuIds: ['m2'] }, menus, [
      { menuId: 'm1', quantity: 1 },
      { menuId: 'm2', quantity: 1 },
    ]);
    expect(q.discount).toBe(3000);
    expect(q.lines.find((l) => l.menuId === 'm1')!.discountRate).toBe(0);
  });
  it('최대 할인 금액 상한', () => {
    const q = quotePrice({ ...rain, maxDiscountAmount: 5000 }, menus, [{ menuId: 'm2', quantity: 3 }]);
    expect(q.discount).toBe(5000);
    expect(q.discountCapped).toBe(true);
  });
  it('원 단위 내림', () => {
    const q = quotePrice({ ...rain, rate: 15 }, [{ ...menus[0]!, price: 9990 }], [{ menuId: 'm1', quantity: 1 }]);
    expect(q.discount).toBe(1498);
  });
  it('최소 주문 금액 미달 거부', () => {
    expect(() => quotePrice({ ...rain, minOrderAmount: 20000 }, menus, [{ menuId: 'm1', quantity: 1 }])).toThrow(PricingError);
  });
  it('품절·다른 매장 메뉴 거부', () => {
    expect(() => quotePrice(rain, menus, [{ menuId: 'm3', quantity: 1 }])).toThrow(PricingError);
    expect(() => quotePrice(rain, menus, [{ menuId: 'x1', quantity: 1 }])).toThrow(PricingError);
  });
  it('할인 대상 메뉴가 하나도 없으면 거부', () => {
    expect(() => quotePrice({ ...rain, scope: 'MENUS', menuIds: ['m2'] }, menus, [{ menuId: 'm1', quantity: 1 }])).toThrow(
      PricingError,
    );
  });
  it('수량 0·소수 거부', () => {
    expect(() => quotePrice(rain, menus, [{ menuId: 'm1', quantity: 0 }])).toThrow(PricingError);
    expect(() => quotePrice(rain, menus, [{ menuId: 'm1', quantity: 1.5 }])).toThrow(PricingError);
  });
});

describe('예약 상태 전이', () => {
  const ctx = { slotStartAt: kstDateTime('2026-07-10', '18:00'), createdAt: now, now };
  it('고객은 확정 예약을 방문 전 취소 가능', () => {
    expect(checkTransition('CANCEL_BY_USER', 'CONFIRMED', 'consumer', ctx)).toEqual({ ok: true, to: 'CANCELLED_BY_USER' });
  });
  it('고객은 방문 완료 처리 불가 (권한)', () => {
    expect(checkTransition('VISIT', 'CONFIRMED', 'consumer', ctx).ok).toBe(false);
  });
  it('취소된 예약은 방문 처리 불가', () => {
    expect(checkTransition('VISIT', 'CANCELLED_BY_USER', 'owner', { ...ctx, now: ctx.slotStartAt }).ok).toBe(false);
  });
  it('방문 확인은 시작 1시간 전부터', () => {
    expect(checkTransition('VISIT', 'CONFIRMED', 'owner', ctx).ok).toBe(false);
    expect(checkTransition('VISIT', 'CONFIRMED', 'owner', { ...ctx, now: kstDateTime('2026-07-10', '17:10') }).ok).toBe(true);
  });
  it('노쇼는 시작 30분 후부터', () => {
    expect(checkTransition('NO_SHOW', 'CONFIRMED', 'owner', { ...ctx, now: kstDateTime('2026-07-10', '18:20') }).ok).toBe(false);
    expect(checkTransition('NO_SHOW', 'CONFIRMED', 'owner', { ...ctx, now: kstDateTime('2026-07-10', '18:31') }).ok).toBe(true);
  });
  it('승인 지연 30분 후 승인 불가', () => {
    expect(checkTransition('APPROVE', 'PENDING', 'owner', { ...ctx, now: kstDateTime('2026-07-10', '12:31') }).ok).toBe(false);
  });
});

describe('유틸', () => {
  it('사업자등록번호 체크섬', () => {
    expect(isValidBusinessNumber('220-81-62517')).toBe(true);
    expect(isValidBusinessNumber('220-81-62518')).toBe(false);
    expect(isValidBusinessNumber('12345')).toBe(false);
  });
  it('기상청 격자 변환 (서울시청 60,127)', () => {
    expect(toKmaGrid({ lat: 37.5665, lng: 126.978 })).toEqual({ nx: 60, ny: 127 });
  });
  it('거리 계산', () => {
    const d = distanceMeters({ lat: 35.2201, lng: 129.0861 }, { lat: 35.2051, lng: 129.0782 });
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(2000);
  });
});
