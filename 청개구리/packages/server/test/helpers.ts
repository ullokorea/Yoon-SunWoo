import { kstDate, kstDateTime } from '@cheong/core';
import {
  auth,
  createContext,
  createPgliteDb,
  MockWeatherAdapter,
  resetRateLimits,
  seed,
  type Actor,
  type Ctx,
  type ServerConfig,
} from '../src/index';

export const TEST_CONFIG: ServerConfig = {
  env: 'test',
  qrSecret: 'test-qr-secret-0123456789abcdefghijklmnop',
  weatherSource: 'mock',
  pushMode: 'mock',
  sessionTtlDays: 30,
};

/** 기준 시각: 2026-07-10(금) KST 12:00 */
export const BASE_NOW = kstDateTime('2026-07-10', '12:00');

export interface TestEnv {
  ctx: Ctx;
  clock: { now: Date; advance(min: number): void; set(d: Date): void };
  login(email: string): Promise<Actor>;
  ids: { oncheon: string; seomyeon: string; kalguksu: string; cafe: string; izakaya: string; pending: string };
  close(): Promise<void>;
}

export async function setup(): Promise<TestEnv> {
  resetRateLimits();
  const clock = {
    now: new Date(BASE_NOW),
    advance(min: number) {
      this.now = new Date(this.now.getTime() + min * 60_000);
    },
    set(d: Date) {
      this.now = new Date(d);
    },
  };
  const db = await createPgliteDb();
  const ctx = await createContext({ db, config: TEST_CONFIG, now: () => clock.now, weather: new MockWeatherAdapter() });
  await seed(ctx);
  const q = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p))[0]!.id;
  const ids = {
    oncheon: await q(`select id from weather_regions where name like '%온천동%'`),
    seomyeon: await q(`select id from weather_regions where name like '%부전동%'`),
    kalguksu: await q(`select id from stores where name like '%칼국수%'`),
    cafe: await q(`select id from stores where name like '%로스터리%'`),
    izakaya: await q(`select id from stores where name like '%이자카야%'`),
    pending: await q(`select id from stores where name like '%승인대기%'`),
  };
  return {
    ctx,
    clock,
    ids,
    async login(email: string) {
      const s = await auth.login(ctx, email, 'cheong1234');
      return (await auth.authenticate(ctx, s.token))!;
    },
    close: () => db.close(),
  };
}

export async function signupConsumer(env: TestEnv, email: string): Promise<Actor> {
  const s = await auth.signup(env.ctx, {
    email,
    password: 'abcd1234',
    nickname: email.split('@')[0]!,
    role: 'consumer',
    agreeTerms: true,
    agreePrivacy: true,
  });
  return (await auth.authenticate(env.ctx, s.token))!;
}

export async function slotAt(env: TestEnv, storeId: string, time: string, date = kstDate(env.clock.now)) {
  const [r] = await env.ctx.db.query<{ id: string }>(`select id from reservation_slots where store_id = $1 and start_at = $2`, [
    storeId,
    kstDateTime(date, time),
  ]);
  if (!r) throw new Error(`slot ${date} ${time} 없음`);
  return r.id;
}

export async function campaignOf(env: TestEnv, storeId: string, kind: string) {
  const [r] = await env.ctx.db.query<{ id: string }>(`select id from discount_campaigns where store_id = $1 and kind = $2`, [storeId, kind]);
  return r!.id;
}

export async function menuOf(env: TestEnv, storeId: string, name: string) {
  const [r] = await env.ctx.db.query<{ id: string }>(`select id from menus where store_id = $1 and name = $2`, [storeId, name]);
  return r!.id;
}
