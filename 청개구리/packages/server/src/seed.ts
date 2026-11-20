// 개발용 샘플 데이터 — 부산 동래구 온천장 일대 (모두 가상, 이름에 [샘플] 표기)
// 운영 환경에서는 실행되지 않는다.

import { kstDate, kstDateTime, toKmaGrid } from '@cheong/core';
import type { Ctx } from './context';
import { hashPassword } from './security';

export const SEED_ACCOUNTS = {
  admin: { email: 'admin@cheong.dev', password: 'cheong1234', nickname: '운영자' },
  owner: { email: 'owner@cheong.dev', password: 'cheong1234', nickname: '사장님' },
  owner2: { email: 'owner2@cheong.dev', password: 'cheong1234', nickname: '카페사장님' },
  consumer: { email: 'user@cheong.dev', password: 'cheong1234', nickname: '비오는날' },
} as const;

const HOURS = (open: string, close: string, closedDays: number[] = []) =>
  Array.from({ length: 7 }, (_, d) => (closedDays.includes(d) ? null : { open, close }));

interface SeedStore {
  key: string;
  owner: 'owner' | 'owner2' | null;
  region: 'oncheon' | 'seomyeon';
  name: string;
  category: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  priceLevel: number;
  hours: ReturnType<typeof HOURS>;
  autoApprove: boolean;
  status: 'APPROVED' | 'PENDING';
  menus: Array<[string, number, boolean?]>;
  rain?: { rate: number; scope?: 'MENUS'; menuIdx?: number[]; dailyLimit?: number; maxDiscount?: number; minOrder?: number; start?: string; end?: string };
  typhoonPre?: number;
  typhoonRecovery?: number;
}

const STORES: SeedStore[] = [
  {
    key: 'kalguksu',
    owner: 'owner',
    region: 'oncheon',
    name: '[샘플] 온천장 손칼국수',
    category: 'KOREAN',
    description: '비 오는 날 생각나는 바지락 칼국수와 해물파전. (개발용 가상 매장)',
    address: '부산 동래구 온천동 (샘플 주소)',
    lat: 35.2205,
    lng: 129.0838,
    priceLevel: 1,
    hours: HOURS('11:00', '21:00', [1]),
    autoApprove: true,
    status: 'APPROVED',
    menus: [['바지락 칼국수', 9000], ['해물파전', 15000], ['김치전', 12000], ['칼국수+파전 세트', 22000, true], ['막걸리', 5000]],
    rain: { rate: 20, dailyLimit: 30 },
    typhoonPre: 35,
    typhoonRecovery: 40,
  },
  {
    key: 'cafe',
    owner: 'owner2',
    region: 'oncheon',
    name: '[샘플] 개굴 로스터리',
    category: 'CAFE',
    description: '창가 자리에서 빗소리 들으며 마시는 핸드드립. (개발용 가상 매장)',
    address: '부산 동래구 온천동 (샘플 주소)',
    lat: 35.2189,
    lng: 129.0852,
    priceLevel: 2,
    hours: HOURS('10:00', '22:00'),
    autoApprove: true,
    status: 'APPROVED',
    menus: [['핸드드립', 6500], ['카페라테', 5500], ['바스크 치즈케이크', 7000], ['비 오는 날 세트 (음료+케이크)', 12000, true]],
    rain: { rate: 15, scope: 'MENUS', menuIdx: [0, 3], maxDiscount: 5000 },
    typhoonRecovery: 30,
  },
  {
    key: 'izakaya',
    owner: 'owner',
    region: 'oncheon',
    name: '[샘플] 동래 우산 이자카야',
    category: 'BAR',
    description: '퇴근길 비 오는 저녁, 따뜻한 오뎅탕. 점주 승인 후 예약 확정. (개발용 가상 매장)',
    address: '부산 동래구 온천동 (샘플 주소)',
    lat: 35.2172,
    lng: 129.0819,
    priceLevel: 2,
    hours: HOURS('17:00', '23:00', [0]),
    autoApprove: false,
    status: 'APPROVED',
    menus: [['오뎅탕', 18000], ['모둠꼬치', 22000], ['하이볼', 7000]],
    rain: { rate: 25, minOrder: 20000, start: '17:00', end: '23:00', dailyLimit: 10 },
  },
  {
    key: 'bakery',
    owner: null,
    region: 'oncheon',
    name: '[샘플] 빗방울 베이커리',
    category: 'BAKERY',
    description: '갓 구운 소금빵. (개발용 가상 매장)',
    address: '부산 동래구 온천동 (샘플 주소)',
    lat: 35.2215,
    lng: 129.0801,
    priceLevel: 1,
    hours: HOURS('08:00', '20:00'),
    autoApprove: true,
    status: 'APPROVED',
    menus: [['소금빵', 3500], ['앙버터', 4500], ['아메리카노', 4000]],
    rain: { rate: 10 },
  },
  {
    key: 'pending',
    owner: 'owner',
    region: 'oncheon',
    name: '[샘플] 승인대기 돈까스',
    category: 'JAPANESE',
    description: '관리자 승인 대기 중인 매장 예시. (개발용 가상 매장)',
    address: '부산 동래구 온천동 (샘플 주소)',
    lat: 35.2199,
    lng: 129.0871,
    priceLevel: 2,
    hours: HOURS('11:00', '21:00'),
    autoApprove: true,
    status: 'PENDING',
    menus: [['등심돈까스', 11000]],
  },
  {
    key: 'seomyeon',
    owner: null,
    region: 'seomyeon',
    name: '[샘플] 서면 비빔국수',
    category: 'KOREAN',
    description: '다른 지역 매장 예시 — 온천장과 날씨가 다를 수 있어요. (개발용 가상 매장)',
    address: '부산 부산진구 부전동 (샘플 주소)',
    lat: 35.1577,
    lng: 129.0592,
    priceLevel: 1,
    hours: HOURS('11:00', '21:00'),
    autoApprove: true,
    status: 'APPROVED',
    menus: [['비빔국수', 8000], ['잔치국수', 7000]],
    rain: { rate: 20 },
  },
];

export async function seed(ctx: Ctx, opts: { force?: boolean } = {}) {
  if (ctx.config.env === 'production') throw new Error('운영 환경에서는 샘플 데이터를 넣을 수 없습니다.');
  const [has] = await ctx.db.query<{ n: number }>(`select count(*)::int as n from users`);
  if ((has?.n ?? 0) > 0 && !opts.force) return { skipped: true };

  const now = ctx.now();
  const pw = await hashPassword('cheong1234');
  const users: Record<string, string> = {};

  await ctx.db.tx(async (q) => {
    for (const [key, acc] of Object.entries(SEED_ACCOUNTS)) {
      const [u] = await q.query<{ id: string }>(`insert into users (email, password_hash) values ($1, $2) returning id`, [acc.email, pw]);
      users[key] = u!.id;
      const role = key === 'admin' ? 'admin' : key.startsWith('owner') ? 'owner' : 'consumer';
      await q.query(`insert into user_roles (user_id, role) values ($1, $2)`, [u!.id, role]);
      await q.query(
        `insert into user_profiles (user_id, nickname, phone, terms_agreed_at, privacy_agreed_at, location_consent_at) values ($1, $2, $3, $4, $4, $4)`,
        [u!.id, acc.nickname, key === 'consumer' ? '010-0000-0000' : null, now],
      );
      await q.query(`insert into notification_preferences (user_id) values ($1)`, [u!.id]);
    }

    const regions: Record<string, string> = {};
    const regionDefs = {
      oncheon: { name: '부산 동래구 온천동', lat: 35.2203, lng: 129.083, code: '159:부산', scenario: 'raining' },
      seomyeon: { name: '부산 부산진구 부전동', lat: 35.1577, lng: 129.0592, code: '159:부산', scenario: 'clear' },
    };
    for (const [key, r] of Object.entries(regionDefs)) {
      const { nx, ny } = toKmaGrid(r);
      const [row] = await q.query<{ id: string }>(
        `insert into weather_regions (name, nx, ny, center_lat, center_lng, warning_area_code, mock_scenario)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (nx, ny) do update set name = excluded.name returning id`,
        [r.name, nx, ny, r.lat, r.lng, r.code, r.scenario],
      );
      regions[key] = row!.id;
    }
    await q.query(`update user_profiles set home_region_id = $2 where user_id = $1`, [users.consumer, regions.oncheon]);

    const validFrom = kstDateTime(kstDate(now), '00:00');
    const validUntil = new Date(validFrom.getTime() + 60 * 86400_000);
    for (const s of STORES) {
      const [st] = await q.query<{ id: string }>(
        `insert into stores (name, category, description, address, lat, lng, region_id, price_level, status, business_hours,
                             auto_approve, is_sample, approved_at, approved_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13) returning id`,
        [s.name, s.category, s.description, s.address, s.lat, s.lng, regions[s.region], s.priceLevel, s.status, JSON.stringify(s.hours),
          s.autoApprove, s.status === 'APPROVED' ? now : null, s.status === 'APPROVED' ? users.admin : null],
      );
      const storeId = st!.id;
      if (s.owner) await q.query(`insert into store_owners (store_id, user_id) values ($1, $2)`, [storeId, users[s.owner]]);
      await q.query(
        `insert into store_business_verifications (store_id, business_number, representative_name, status) values ($1, '0000000000', '샘플대표', $2)`,
        [storeId, s.status === 'APPROVED' ? 'APPROVED' : 'SUBMITTED'],
      );
      const menuIds: string[] = [];
      for (const [i, [name, price, isSet]] of s.menus.entries()) {
        const [m] = await q.query<{ id: string }>(
          `insert into menus (store_id, name, price, is_set, sort_order) values ($1, $2, $3, $4, $5) returning id`,
          [storeId, name, price, !!isSet, i],
        );
        menuIds.push(m!.id);
      }
      const addCampaign = async (
        kind: string,
        title: string,
        rate: number,
        extra: { scope?: 'MENUS'; menuIdx?: number[]; dailyLimit?: number; maxDiscount?: number; minOrder?: number; start?: string; end?: string } = {},
      ) => {
        const day = s.hours.find((h) => h) ?? { open: '11:00', close: '21:00' };
        const [c] = await q.query<{ id: string }>(
          `insert into discount_campaigns (store_id, kind, title, rate, scope, daily_start_time, daily_end_time, valid_from, valid_until,
                                           max_discount_amount, min_order_amount, max_party_size, daily_limit, status, reviewed_by, reviewed_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 6, $12, 'APPROVED', $13, $14) returning id`,
          [storeId, kind, title, rate, extra.scope ?? 'ALL', extra.start ?? day.open, extra.end ?? day.close, validFrom, validUntil,
            extra.maxDiscount ?? null, extra.minOrder ?? 0, extra.dailyLimit ?? null, users.admin, now],
        );
        for (const idx of extra.menuIdx ?? []) {
          await q.query(`insert into discount_rules (campaign_id, menu_id) values ($1, $2)`, [c!.id, menuIds[idx]]);
        }
      };
      if (s.rain) await addCampaign('RAIN', `비 오는 날 ${s.rain.rate}% 할인`, s.rain.rate, s.rain);
      if (s.typhoonPre) await addCampaign('TYPHOON_PRE', `태풍 오기 전 ${s.typhoonPre}% 특가`, s.typhoonPre);
      if (s.typhoonRecovery) await addCampaign('TYPHOON_RECOVERY', `태풍 회복 응원 ${s.typhoonRecovery}% 특가`, s.typhoonRecovery);

      // 오늘부터 4일간, 영업시간 내 매시 정각 슬롯
      for (let d = 0; d < 4; d++) {
        const date = kstDate(new Date(now.getTime() + d * 86400_000));
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        const h = s.hours[weekday];
        if (!h) continue;
        const open = Number(h.open.slice(0, 2));
        const close = Number(h.close.slice(0, 2));
        for (let hr = open; hr + 1 <= close; hr++) {
          const start = kstDateTime(date, `${String(hr).padStart(2, '0')}:00`);
          if (start <= now) continue;
          await q.query(`insert into reservation_slots (store_id, start_at, capacity) values ($1, $2, $3)`, [storeId, start, s.category === 'CAFE' ? 12 : 8]);
        }
      }
    }
  });

  // 샘플 지역 날씨 판정 (Mock 시나리오 반영)
  const { refreshAllRegions } = await import('./services/weather');
  if (ctx.config.weatherSource === 'mock') await refreshAllRegions(ctx);
  return { skipped: false, accounts: Object.values(SEED_ACCOUNTS).map((a) => a.email) };
}
