import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { kstDateTime } from '@cheong/core';
import { AppError, auth, campaigns, notifications, reservations, stats, stores, weather } from '../src/index';
import { campaignOf, menuOf, setup, signupConsumer, slotAt, type TestEnv } from './helpers';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.close();
});

async function expectError(p: Promise<unknown>, code?: string, detailCode?: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    if (code) expect(err.code).toBe(code);
    if (detailCode) expect((err.detail as { code?: string; result?: string })?.code ?? (err.detail as { result?: string })?.result).toBe(detailCode);
    return err;
  }
  throw new Error('에러가 발생해야 합니다');
}

async function bookKalguksu(actor: Awaited<ReturnType<TestEnv['login']>>, time = '18:00', extra: Record<string, unknown> = {}) {
  return reservations.createReservation(env.ctx, actor, {
    storeId: env.ids.kalguksu,
    slotId: await slotAt(env, env.ids.kalguksu, time),
    campaignId: await campaignOf(env, env.ids.kalguksu, 'RAIN'),
    partySize: 2,
    items: [
      { menuId: await menuOf(env, env.ids.kalguksu, '바지락 칼국수'), quantity: 2 },
      { menuId: await menuOf(env, env.ids.kalguksu, '해물파전'), quantity: 1 },
    ],
    ...extra,
  } as never);
}

describe('인증', () => {
  it('회원가입·로그인·로그아웃', async () => {
    const s = await auth.signup(env.ctx, { email: 'New@Test.dev', password: 'abcd1234', nickname: '새회원', role: 'consumer', agreeTerms: true, agreePrivacy: true });
    expect(s.user.roles).toEqual(['consumer']);
    const a = await auth.authenticate(env.ctx, s.token);
    expect(a?.userId).toBe(s.user.id);
    await auth.logout(env.ctx, s.token);
    expect(await auth.authenticate(env.ctx, s.token)).toBeNull();
    const again = await auth.login(env.ctx, 'new@test.dev', 'abcd1234');
    expect(again.token).toBeTruthy();
  });
  it('중복 이메일·약한 비밀번호·약관 미동의 거부', async () => {
    const base = { password: 'abcd1234', nickname: 'x', role: 'consumer' as const, agreeTerms: true, agreePrivacy: true };
    await expectError(auth.signup(env.ctx, { ...base, email: 'user@cheong.dev' }), 'CONFLICT');
    await expectError(auth.signup(env.ctx, { ...base, email: 'a@b.dev', password: 'short' }), 'VALIDATION');
    await expectError(auth.signup(env.ctx, { ...base, email: 'a@b.dev', agreePrivacy: false }), 'VALIDATION');
  });
  it('회원가입으로 관리자 계정을 만들 수 없다', async () => {
    await expectError(
      auth.signup(env.ctx, { email: 'x@b.dev', password: 'abcd1234', nickname: 'x', role: 'admin' as never, agreeTerms: true, agreePrivacy: true }),
      'VALIDATION',
    );
  });
  it('틀린 비밀번호 거부', async () => {
    await expectError(auth.login(env.ctx, 'user@cheong.dev', 'wrong1234'), 'UNAUTHORIZED');
  });
  it('회원 탈퇴: 개인정보 파기, 예정 예약 취소·좌석 반환, 세션 만료', async () => {
    const u = await signupConsumer(env, 'bye@test.dev');
    const r = await bookKalguksu(u);
    const slotId = await slotAt(env, env.ids.kalguksu, '18:00');
    await auth.withdraw(env.ctx, u, 'abcd1234');
    const [row] = await env.ctx.db.query<{ status: string; email: string }>(`select status, email from users where id = $1`, [u.userId]);
    expect(row!.status).toBe('WITHDRAWN');
    expect(row!.email).not.toContain('bye@');
    const [res] = await env.ctx.db.query<{ status: string }>(`select status from reservations where id = $1`, [r.id]);
    expect(res!.status).toBe('CANCELLED_BY_USER');
    const [slot] = await env.ctx.db.query<{ booked: number }>(`select booked from reservation_slots where id = $1`, [slotId]);
    expect(slot!.booked).toBe(0);
    await expectError(auth.login(env.ctx, 'bye@test.dev', 'abcd1234'), 'UNAUTHORIZED');
  });
});

describe('날씨 판정', () => {
  it('시드: 온천동은 비(Mock), 부전동은 맑음', async () => {
    const list = await weather.listRegions(env.ctx);
    expect(list.find((r) => r.id === env.ids.oncheon)!.mode).toBe('RAINING');
    expect(list.find((r) => r.id === env.ids.seomyeon)!.mode).toBe('CLEAR');
    expect(list.every((r) => r.isMock)).toBe(true);
  });
  it('관리자만 Mock 시나리오를 바꿀 수 있다', async () => {
    const user = await env.login('user@cheong.dev');
    await expectError(weather.setMockScenario(env.ctx, user, env.ids.oncheon, 'clear'), 'FORBIDDEN');
  });
  it('상태 전환 이력이 기록된다', async () => {
    const h = await weather.regionHistory(env.ctx, env.ids.oncheon);
    expect(h.length).toBeGreaterThan(0);
  });
});

describe('예약 — 정상 흐름', () => {
  it('비 오는 날 예약 → 서버 가격 계산 → QR → 방문 확인', async () => {
    const user = await env.login('user@cheong.dev');
    // 클라이언트가 가격을 조작해 보내도 무시된다
    const r = await bookKalguksu(user, '18:00', { totalAmount: 1, discountRate: 99 });
    expect(r.status).toBe('CONFIRMED');
    expect(r.subtotal).toBe(33000);
    expect(r.discountRate).toBe(20);
    expect(r.discountAmount).toBe(6600);
    expect(r.totalAmount).toBe(26400);
    expect(r.qrToken).toMatch(/^CGQR1\./);
    expect(r.code).toMatch(/^CG-[A-Z0-9]{6}$/);

    const owner = await env.login('owner@cheong.dev');
    // 방문 1시간 전 이전에는 확인 불가
    await expectError(reservations.verifyVisit(env.ctx, owner, env.ids.kalguksu, { token: r.qrToken! }), 'CONFLICT');
    env.clock.set(kstDateTime('2026-07-10', '17:50'));
    const v = await reservations.verifyVisit(env.ctx, owner, env.ids.kalguksu, { token: r.qrToken! });
    expect(v.status).toBe('VISITED');
    // 동일 QR 재사용
    await expectError(reservations.verifyVisit(env.ctx, owner, env.ids.kalguksu, { token: r.qrToken! }), 'CONFLICT', 'REUSED');
    // 통계: 확정 vs 추정 구분
    const s = await stats.ownerStats(env.ctx, owner, env.ids.kalguksu);
    expect(s.confirmed.discountGiven).toBe(6600);
    expect(s.estimated.label).toContain('추정');
  });

  it('위조·변조된 QR 거부', async () => {
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user);
    env.clock.set(kstDateTime('2026-07-10', '17:50'));
    const owner = await env.login('owner@cheong.dev');
    const tampered = r.qrToken!.slice(0, -2) + (r.qrToken!.endsWith('A') ? 'BB' : 'AA');
    await expectError(reservations.verifyVisit(env.ctx, owner, env.ids.kalguksu, { token: tampered }), 'VALIDATION');
    await expectError(reservations.verifyVisit(env.ctx, owner, env.ids.kalguksu, { token: 'garbage' }), 'VALIDATION');
  });

  it('예약 취소 시 좌석 반환, 취소된 예약의 QR 사용 불가', async () => {
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user);
    const token = r.qrToken!;
    const c = await reservations.cancelByUser(env.ctx, user, r.id);
    expect(c.status).toBe('CANCELLED_BY_USER');
    expect(c.qrToken).toBeNull();
    const [slot] = await env.ctx.db.query<{ booked: number }>(`select booked from reservation_slots where id = $1`, [
      await slotAt(env, env.ids.kalguksu, '18:00'),
    ]);
    expect(slot!.booked).toBe(0);
    env.clock.set(kstDateTime('2026-07-10', '17:50'));
    const owner = await env.login('owner@cheong.dev');
    await expectError(reservations.verifyVisit(env.ctx, owner, env.ids.kalguksu, { token }), 'CONFLICT', 'NOT_CONFIRMED');
  });

  it('할인율을 바꿔도 확정 예약 조건은 유지', async () => {
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user);
    const owner = await env.login('owner@cheong.dev');
    await campaigns.updateCampaign(env.ctx, owner, env.ids.kalguksu, await campaignOf(env, env.ids.kalguksu, 'RAIN'), { rate: 30 });
    const after = await reservations.getReservation(env.ctx, user, r.id);
    expect(after.discountRate).toBe(20);
    expect(after.totalAmount).toBe(26400);
  });

  it('점주 승인 매장: PENDING → 승인 → CONFIRMED, 승인 지연 시 만료', async () => {
    const user = await env.login('user@cheong.dev');
    const owner = await env.login('owner@cheong.dev');
    const book = async (u: typeof user, time: string) =>
      reservations.createReservation(env.ctx, u, {
        storeId: env.ids.izakaya,
        slotId: await slotAt(env, env.ids.izakaya, time),
        campaignId: await campaignOf(env, env.ids.izakaya, 'RAIN'),
        partySize: 2,
        items: [{ menuId: await menuOf(env, env.ids.izakaya, '오뎅탕'), quantity: 1 }, { menuId: await menuOf(env, env.ids.izakaya, '하이볼'), quantity: 2 }],
      });
    const r = await book(user, '19:00');
    expect(r.status).toBe('PENDING');
    expect(r.qrToken).toBeNull();
    const ok = await reservations.ownerAction(env.ctx, owner, env.ids.izakaya, r.id, 'APPROVE');
    expect(ok.status).toBe('CONFIRMED');

    const u2 = await signupConsumer(env, 'late@test.dev');
    const r2 = await book(u2, '20:00');
    env.clock.advance(31);
    await expectError(reservations.ownerAction(env.ctx, owner, env.ids.izakaya, r2.id, 'APPROVE'), 'CONFLICT');
    expect(await reservations.expirePendingReservations(env.ctx)).toBe(1);
    const after = await reservations.getReservation(env.ctx, u2, r2.id);
    expect(after.status).toBe('EXPIRED');
  });

  it('최소 주문 금액 미달 거부', async () => {
    const user = await env.login('user@cheong.dev');
    await expectError(
      reservations.createReservation(env.ctx, user, {
        storeId: env.ids.izakaya,
        slotId: await slotAt(env, env.ids.izakaya, '19:00'),
        campaignId: await campaignOf(env, env.ids.izakaya, 'RAIN'),
        partySize: 1,
        items: [{ menuId: await menuOf(env, env.ids.izakaya, '하이볼'), quantity: 1 }],
      }),
      'VALIDATION',
      'MIN_ORDER',
    );
  });

  it('노쇼 처리는 방문 30분 후부터', async () => {
    const user = await env.login('user@cheong.dev');
    const owner = await env.login('owner@cheong.dev');
    const r = await bookKalguksu(user, '13:00');
    env.clock.set(kstDateTime('2026-07-10', '13:20'));
    await expectError(reservations.ownerAction(env.ctx, owner, env.ids.kalguksu, r.id, 'NO_SHOW'), 'CONFLICT');
    env.clock.set(kstDateTime('2026-07-10', '13:31'));
    expect((await reservations.ownerAction(env.ctx, owner, env.ids.kalguksu, r.id, 'NO_SHOW')).status).toBe('NO_SHOW');
  });
});

describe('예약 — 예외', () => {
  it('동시에 여러 명이 예약해도 정원을 넘지 않는다', async () => {
    const slotId = await slotAt(env, env.ids.kalguksu, '19:00');
    await env.ctx.db.query(`update reservation_slots set capacity = 3 where id = $1`, [slotId]);
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => signupConsumer(env, `race${i}@test.dev`)));
    const campaignId = await campaignOf(env, env.ids.kalguksu, 'RAIN');
    const menuId = await menuOf(env, env.ids.kalguksu, '바지락 칼국수');
    const results = await Promise.allSettled(
      users.map((u) =>
        reservations.createReservation(env.ctx, u, { storeId: env.ids.kalguksu, slotId, campaignId, partySize: 1, items: [{ menuId, quantity: 1 }] }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const [slot] = await env.ctx.db.query<{ booked: number }>(`select booked from reservation_slots where id = $1`, [slotId]);
    expect(slot!.booked).toBe(3);
  });

  it('선착순 하루 한도', async () => {
    const campaignId = await campaignOf(env, env.ids.kalguksu, 'RAIN');
    await env.ctx.db.query(`update discount_campaigns set daily_limit = 2 where id = $1`, [campaignId]);
    const [a, b, c] = await Promise.all(['l1', 'l2', 'l3'].map((n) => signupConsumer(env, `${n}@test.dev`)));
    await bookKalguksu(a!, '15:00');
    await bookKalguksu(b!, '16:00');
    await expectError(bookKalguksu(c!, '17:00'), 'BOOKING_BLOCKED', 'DAILY_LIMIT');
  });

  it('같은 날 같은 매장 중복 예약 방지', async () => {
    const user = await env.login('user@cheong.dev');
    await bookKalguksu(user, '15:00');
    await expectError(bookKalguksu(user, '17:00'), 'CONFLICT', 'DUPLICATE');
  });

  it('맑은 지역에서는 우천 할인 예약 불가', async () => {
    const user = await env.login('user@cheong.dev');
    const [store] = await env.ctx.db.query<{ id: string }>(`select id from stores where name like '%비빔국수%'`);
    await expectError(
      reservations.createReservation(env.ctx, user, {
        storeId: store!.id,
        slotId: await slotAt(env, store!.id, '18:00'),
        campaignId: await campaignOf(env, store!.id, 'RAIN'),
        partySize: 1,
        items: [{ menuId: await menuOf(env, store!.id, '비빔국수'), quantity: 1 }],
      }),
      'BOOKING_BLOCKED',
      'NOT_RAINING',
    );
  });

  it('비가 그쳐도 확정 예약은 유지, 신규 예약은 마감', async () => {
    const admin = await env.login('admin@cheong.dev');
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user, '18:00');
    await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, 'clear');
    env.clock.advance(70);
    await weather.refreshRegion(env.ctx, env.ids.oncheon);
    const region = (await weather.listRegions(env.ctx)).find((x) => x.id === env.ids.oncheon)!;
    expect(region.mode).toBe('CLEAR');
    expect((await reservations.getReservation(env.ctx, user, r.id)).status).toBe('CONFIRMED');
    const u2 = await signupConsumer(env, 'after@test.dev');
    await expectError(bookKalguksu(u2, '19:00'), 'BOOKING_BLOCKED', 'NOT_RAINING');
  });

  it('기상 API 장애 30분 초과 → 판정 불가 → 신규 예약 제한', async () => {
    const admin = await env.login('admin@cheong.dev');
    await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, 'api_failure');
    const user = await env.login('user@cheong.dev');
    // 직전 정상 데이터가 유효한 동안은 유지
    await bookKalguksu(user, '15:00');
    env.clock.advance(40);
    await weather.refreshRegion(env.ctx, env.ids.oncheon);
    const region = (await weather.listRegions(env.ctx)).find((x) => x.id === env.ids.oncheon)!;
    expect(region.mode).toBe('UNKNOWN');
    expect(region.lastFetchError).toContain('MOCK');
    const u2 = await signupConsumer(env, 'fail@test.dev');
    await expectError(bookKalguksu(u2, '18:00'), 'BOOKING_BLOCKED', 'WEATHER_UNKNOWN');
  });

  it('매장 영업 중단 시 예약 불가', async () => {
    const owner = await env.login('owner@cheong.dev');
    await stores.setOperationPaused(env.ctx, owner, env.ids.kalguksu, true);
    const user = await env.login('user@cheong.dev');
    await expectError(bookKalguksu(user), 'BOOKING_BLOCKED', 'STORE_PAUSED');
  });

  it('닫힌 슬롯·지난 슬롯 예약 불가', async () => {
    const owner = await env.login('owner@cheong.dev');
    const slotId = await slotAt(env, env.ids.kalguksu, '18:00');
    await stores.setSlotClosed(env.ctx, owner, env.ids.kalguksu, slotId, true);
    const user = await env.login('user@cheong.dev');
    await expectError(bookKalguksu(user, '18:00'), 'BOOKING_BLOCKED', 'SLOT_UNAVAILABLE');
    env.clock.set(kstDateTime('2026-07-10', '16:55'));
    await expectError(bookKalguksu(user, '17:00'), 'BOOKING_BLOCKED', 'SLOT_TOO_SOON');
  });
});

describe('태풍 스페셜', () => {
  it('접근 → 사전 특가 / 회복 사전예약 → 특보 발효 시 차단·안내 → 해제 → 운영자 안전 확인 → 영업 재개 후 회복 특가', async () => {
    const admin = await env.login('admin@cheong.dev');
    const owner = await env.login('owner@cheong.dev');
    const user = await env.login('user@cheong.dev');
    const menuId = await menuOf(env, env.ids.kalguksu, '바지락 칼국수');
    const pre = await campaignOf(env, env.ids.kalguksu, 'TYPHOON_PRE');
    const rec = await campaignOf(env, env.ids.kalguksu, 'TYPHOON_RECOVERY');

    // 1) 태풍 접근 예보
    await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, 'typhoon_watch');
    let region = (await weather.listRegions(env.ctx)).find((x) => x.id === env.ids.oncheon)!;
    expect(region.mode).toBe('TYPHOON_WATCH');
    const r1 = await reservations.createReservation(env.ctx, user, {
      storeId: env.ids.kalguksu, slotId: await slotAt(env, env.ids.kalguksu, '18:00'), campaignId: pre, partySize: 2, items: [{ menuId, quantity: 2 }],
    });
    expect(r1.discountRate).toBe(35);

    // 태풍 이후(종료+24h 이후) 방문 사전 예약: 점주가 슬롯을 연다
    await stores.generateSlots(env.ctx, owner, env.ids.kalguksu, { dates: ['2026-07-14'], times: ['12:00'], capacity: 8 });
    const u2 = await signupConsumer(env, 'typhoon@test.dev');
    const r2 = await reservations.createReservation(env.ctx, u2, {
      storeId: env.ids.kalguksu, slotId: await slotAt(env, env.ids.kalguksu, '12:00', '2026-07-14'), campaignId: rec, partySize: 2, items: [{ menuId, quantity: 2 }],
    });
    expect(r2.discountRate).toBe(40);
    // 너무 이른 회복 특가 슬롯은 거부
    const u3 = await signupConsumer(env, 'early@test.dev');
    await expectError(
      reservations.createReservation(env.ctx, u3, {
        storeId: env.ids.kalguksu, slotId: await slotAt(env, env.ids.kalguksu, '12:00', '2026-07-11'), campaignId: rec, partySize: 1, items: [{ menuId, quantity: 1 }],
      }),
      'BOOKING_BLOCKED',
      'TYPHOON_UNSAFE_TIME',
    );

    // 2) 태풍경보 발효 → 위험
    await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, 'typhoon_warning');
    region = (await weather.listRegions(env.ctx)).find((x) => x.id === env.ids.oncheon)!;
    expect(region.mode).toBe('DANGER');
    expect(region.copy.bookingOpen).toBe(false);
    await expectError(
      reservations.createReservation(env.ctx, u3, {
        storeId: env.ids.kalguksu, slotId: await slotAt(env, env.ids.kalguksu, '12:00', '2026-07-14'), campaignId: rec, partySize: 1, items: [{ menuId, quantity: 1 }],
      }),
      'BOOKING_BLOCKED',
      'SAFETY_DANGER',
    );
    // 기존 예약자에게 안전 안내 알림, 취소는 '기상 안전 취소'로
    const notes = await notifications.listMyNotifications(env.ctx, user);
    expect(notes.some((n) => (n as { type: string }).type === 'RESERVATION_SAFETY')).toBe(true);
    const c = await reservations.cancelByUser(env.ctx, user, r1.id);
    expect(c.status).toBe('CANCELLED_SAFETY');
    // 확정 예약(태풍 이후 방문)은 자동 취소하지 않는다
    expect((await reservations.getReservation(env.ctx, u2, r2.id)).status).toBe('CONFIRMED');

    // 3) 특보 해제 → 유예 중에는 위험 유지, 운영자가 안전 확인 전 회복 전환 시도
    await expectError(weather.adminSetSafety(env.ctx, admin, env.ids.oncheon, 'RECOVERY', '현장 확인'), 'CONFLICT');
    await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, 'after_typhoon');
    region = (await weather.listRegions(env.ctx)).find((x) => x.id === env.ids.oncheon)!;
    expect(region.mode).toBe('DANGER');
    const rec2 = await weather.adminSetSafety(env.ctx, admin, env.ids.oncheon, 'RECOVERY', '구청 침수 피해 없음 확인');
    expect(rec2.mode).toBe('RECOVERY');

    // 4) 점주 영업 재개 확인 전에는 회복 특가 불가 (특보 해제 후 매장 미운영)
    await stores.generateSlots(env.ctx, owner, env.ids.kalguksu, { dates: ['2026-07-10'], times: ['20:00'], capacity: 8 });
    const slot20 = await slotAt(env, env.ids.kalguksu, '20:00');
    const tryRec = () =>
      reservations.createReservation(env.ctx, u3, { storeId: env.ids.kalguksu, slotId: slot20, campaignId: rec, partySize: 1, items: [{ menuId, quantity: 1 }] });
    await expectError(tryRec(), 'BOOKING_BLOCKED', 'STORE_NOT_REOPENED');
    await stores.confirmReopen(env.ctx, owner, env.ids.kalguksu);
    const ok = await tryRec();
    expect(ok.discountRate).toBe(40);

    // 감사 로그에 운영자 판단 기록
    const logs = await stats.adminAuditLogs(env.ctx, admin);
    expect(logs.some((l) => (l as unknown as { action: string }).action === 'WEATHER_SAFETY_OVERRIDE')).toBe(true);
  });

  it('호우경보도 위험으로 보고 예약 차단', async () => {
    const admin = await env.login('admin@cheong.dev');
    await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, 'heavy_rain_warning');
    const user = await env.login('user@cheong.dev');
    await expectError(bookKalguksu(user), 'BOOKING_BLOCKED', 'SAFETY_DANGER');
  });
});

describe('권한', () => {
  it('소비자는 점주 기능을 쓸 수 없다', async () => {
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user);
    await expectError(reservations.ownerAction(env.ctx, user, env.ids.kalguksu, r.id, 'NO_SHOW'), 'FORBIDDEN');
    await expectError(stores.createMenu(env.ctx, user, env.ids.kalguksu, { name: 'x', price: 1000 }), 'FORBIDDEN');
  });
  it('다른 점주의 매장·예약에 접근할 수 없다', async () => {
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user);
    const owner2 = await env.login('owner2@cheong.dev');
    await expectError(stores.updateStore(env.ctx, owner2, env.ids.kalguksu, { name: '탈취' }), 'FORBIDDEN');
    await expectError(reservations.listStoreReservations(env.ctx, owner2, env.ids.kalguksu), 'FORBIDDEN');
    await expectError(reservations.getReservation(env.ctx, owner2, r.id), 'NOT_FOUND');
    // 다른 매장에서 QR 확인 시도
    env.clock.set(kstDateTime('2026-07-10', '17:50'));
    await expectError(reservations.verifyVisit(env.ctx, owner2, env.ids.cafe, { token: r.qrToken! }), 'FORBIDDEN');
  });
  it('다른 소비자의 예약을 보거나 취소할 수 없다', async () => {
    const user = await env.login('user@cheong.dev');
    const r = await bookKalguksu(user);
    const other = await signupConsumer(env, 'other@test.dev');
    await expectError(reservations.getReservation(env.ctx, other, r.id), 'NOT_FOUND');
    await expectError(reservations.cancelByUser(env.ctx, other, r.id), 'NOT_FOUND');
  });
  it('점주에게 고객 전화번호는 마스킹되어 보인다', async () => {
    const user = await env.login('user@cheong.dev');
    await bookKalguksu(user);
    const owner = await env.login('owner@cheong.dev');
    const list = await reservations.listStoreReservations(env.ctx, owner, env.ids.kalguksu);
    expect(list[0]!.customerPhone).toBe('010-****-0000');
  });
  it('미승인 매장은 소비자 목록·상세에 노출되지 않고, 관리자 승인 후 노출', async () => {
    const user = await env.login('user@cheong.dev');
    const list = await stores.listStores(env.ctx, {}, user);
    expect(list.some((s) => s.id === env.ids.pending)).toBe(false);
    await expectError(stores.getStoreDetail(env.ctx, env.ids.pending, user), 'NOT_FOUND');
    const admin = await env.login('admin@cheong.dev');
    await stores.adminReviewStore(env.ctx, admin, env.ids.pending, 'APPROVE');
    const list2 = await stores.listStores(env.ctx, {}, user);
    expect(list2.some((s) => s.id === env.ids.pending)).toBe(true);
  });
  it('점주는 관리자 기능을 쓸 수 없다', async () => {
    const owner = await env.login('owner@cheong.dev');
    await expectError(stores.adminReviewStore(env.ctx, owner, env.ids.pending, 'APPROVE'), 'FORBIDDEN');
    await expectError(stats.adminOverview(env.ctx, owner), 'FORBIDDEN');
  });
});

describe('점주 기능', () => {
  it('매장 등록 → 승인 대기, 사업자번호 검증', async () => {
    const owner = await env.login('owner@cheong.dev');
    const input = {
      name: '새 매장', category: 'KOREAN', address: '부산 동래구 명륜동', lat: 35.2128, lng: 129.0794,
      businessHours: Array(7).fill({ open: '11:00', close: '21:00' }), businessNumber: '123-45-67890', representativeName: '홍길동',
    };
    await expectError(stores.createStore(env.ctx, owner, input), 'VALIDATION');
    const s = await stores.createStore(env.ctx, owner, { ...input, businessNumber: '220-81-62517' });
    expect(s.status).toBe('PENDING');
  });
  it('할인율 범위 검증, 태풍 특가는 관리자 검수 필요', async () => {
    const owner = await env.login('owner@cheong.dev');
    const base = {
      title: '테스트', scope: 'ALL' as const, dailyStartTime: '11:00', dailyEndTime: '20:00',
      validFrom: '2026-07-10T00:00:00Z', validUntil: '2026-07-20T00:00:00Z',
    };
    await expectError(campaigns.createCampaign(env.ctx, owner, env.ids.kalguksu, { ...base, kind: 'RAIN', rate: 35 }), 'VALIDATION');
    const t = await campaigns.createCampaign(env.ctx, owner, env.ids.kalguksu, { ...base, kind: 'TYPHOON_PRE', rate: 50 });
    expect(t.status).toBe('PENDING_REVIEW');
    const admin = await env.login('admin@cheong.dev');
    await campaigns.adminReviewCampaign(env.ctx, admin, t.id, 'APPROVE');
    const list = await campaigns.listStoreCampaigns(env.ctx, owner, env.ids.kalguksu);
    expect(list.find((c) => c.id === t.id)!.status).toBe('APPROVED');
  });
  it('영업시간 밖 슬롯은 생성하지 않는다', async () => {
    const owner = await env.login('owner@cheong.dev');
    const r = await stores.generateSlots(env.ctx, owner, env.ids.kalguksu, { dates: ['2026-07-11'], times: ['09:00', '20:30', '12:30'], capacity: 4 });
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(2);
  });
  it('대시보드', async () => {
    const owner = await env.login('owner@cheong.dev');
    const user = await env.login('user@cheong.dev');
    await bookKalguksu(user);
    const d = await stats.ownerDashboard(env.ctx, owner, env.ids.kalguksu);
    expect(d.today!.confirmed).toBe(1);
    expect(d.region.mode).toBe('RAINING');
  });
});

describe('소비자 탐색·알림', () => {
  it('비 오는 지역 매장은 할인율과 예약 가능 표시, 할인율순 정렬', async () => {
    const user = await env.login('user@cheong.dev');
    const list = await stores.listStores(env.ctx, { lat: 35.2203, lng: 129.083, sort: 'discount' }, user);
    const k = list.find((s) => s.id === env.ids.kalguksu)!;
    expect(k.liveRate).toBe(20);
    expect(k.bookable).toBe(true);
    expect(k.distanceMeters).toBeLessThan(200);
    expect(list[0]!.liveRate).toBe(25);
    const clear = list.find((s) => s.name.includes('비빔국수'))!;
    expect(clear.liveRate).toBeNull();
    expect(clear.rainPreviewRate).toBe(20);
  });
  it('필터: 카테고리·예약 가능', async () => {
    const cafes = await stores.listStores(env.ctx, { category: 'CAFE' });
    expect(cafes.every((s) => s.category === 'CAFE')).toBe(true);
    const avail = await stores.listStores(env.ctx, { availableOnly: true });
    expect(avail.every((s) => s.bookable)).toBe(true);
  });
  it('비 시작 알림은 반복 발송되지 않는다 (빈도 제한)', async () => {
    const admin = await env.login('admin@cheong.dev');
    const user = await env.login('user@cheong.dev');
    for (const s of ['clear', 'raining', 'clear', 'raining']) {
      await weather.setMockScenario(env.ctx, admin, env.ids.oncheon, s);
      env.clock.advance(70);
      await weather.refreshRegion(env.ctx, env.ids.oncheon);
      env.clock.advance(10);
      await weather.refreshRegion(env.ctx, env.ids.oncheon);
    }
    const notes = (await notifications.listMyNotifications(env.ctx, user)) as Array<{ type: string }>;
    expect(notes.filter((n) => n.type === 'RAIN_START').length).toBeLessThanOrEqual(2);
  });
  it('알림 설정을 끄면 비 알림이 쌓이지 않는다', async () => {
    const admin = await env.login('admin@cheong.dev');
    const user = await env.login('user@cheong.dev');
    await env.ctx.db.query(`delete from notifications`);
    await notifications.updatePreferences(env.ctx, user, { rainAlerts: false });
    await weather.setMockScenario(env.ctx, admin, env.ids.seomyeon, 'raining');
    await env.ctx.db.query(`update user_profiles set home_region_id = $2 where user_id = $1`, [user.userId, env.ids.seomyeon]);
    await weather.setMockScenario(env.ctx, admin, env.ids.seomyeon, 'clear');
    env.clock.advance(70);
    await weather.refreshRegion(env.ctx, env.ids.seomyeon);
    await weather.refreshRegion(env.ctx, env.ids.seomyeon);
    await weather.setMockScenario(env.ctx, admin, env.ids.seomyeon, 'raining');
    const notes = (await notifications.listMyNotifications(env.ctx, user)) as Array<{ type: string }>;
    expect(notes.filter((n) => n.type === 'RAIN_START')).toHaveLength(0);
  });
  it('즐겨찾기', async () => {
    const user = await env.login('user@cheong.dev');
    await stores.setFavorite(env.ctx, user, env.ids.cafe, true);
    const favs = await stores.listFavorites(env.ctx, user);
    expect(favs.map((f) => f.id)).toEqual([env.ids.cafe]);
    await stores.setFavorite(env.ctx, user, env.ids.cafe, false);
    expect(await stores.listFavorites(env.ctx, user)).toHaveLength(0);
  });
});
