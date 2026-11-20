import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Ctx, ServerConfig } from './context';
import { createPgliteDb, createPostgresDb, findRepoRoot, migrate, type Db } from './db';
import { ExpoPushSender, MockPushSender } from './services/notifications';
import { KmaWeatherAdapter, MockWeatherAdapter, type WeatherAdapter } from './weather/adapters';

export * from './context';
export * from './db';
export * from './errors';
export * from './security';
export * from './weather/adapters';
export * as auth from './services/auth';
export * as stores from './services/stores';
export * as campaigns from './services/campaigns';
export * as reservations from './services/reservations';
export * as weather from './services/weather';
export * as notifications from './services/notifications';
export * as stats from './services/stats';
export { seed } from './seed';

const DEV_QR_SECRET = 'dev-only-insecure-qr-secret-do-not-use-in-production';

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mode = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const qrSecret = env.QR_SECRET || (mode === 'production' ? '' : DEV_QR_SECRET);
  if (mode === 'production' && (!qrSecret || qrSecret.length < 32)) {
    throw new Error('운영 환경에서는 32자 이상의 QR_SECRET 이 필요합니다.');
  }
  const weatherSource = env.WEATHER_SOURCE === 'mock' || !env.KMA_SERVICE_KEY ? 'mock' : 'kma';
  if (mode === 'production' && weatherSource === 'mock' && env.ALLOW_MOCK_WEATHER_IN_PRODUCTION !== 'true') {
    throw new Error('운영 환경에서 Mock 날씨를 쓰려면 ALLOW_MOCK_WEATHER_IN_PRODUCTION=true 를 명시해야 합니다. (KMA_SERVICE_KEY 설정 권장)');
  }
  return {
    env: mode,
    qrSecret,
    weatherSource,
    pushMode: env.PUSH_MODE === 'expo' ? 'expo' : 'mock',
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
  };
}

export function repoRoot(): string {
  return findRepoRoot();
}

export async function openDb(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  if (env.DATABASE_URL) return createPostgresDb(env.DATABASE_URL);
  const dir = env.PGLITE_DATA_DIR ? resolve(/*turbopackIgnore: true*/ env.PGLITE_DATA_DIR) : join(/*turbopackIgnore: true*/ repoRoot(), '.data', 'pglite');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return createPgliteDb(dir);
}

export async function createContext(opts: { db?: Db; config?: ServerConfig; now?: () => Date; weather?: WeatherAdapter } = {}): Promise<Ctx> {
  const config = opts.config ?? configFromEnv();
  const db = opts.db ?? (await openDb());
  await migrate(db);
  const weather =
    opts.weather ?? (config.weatherSource === 'kma' ? new KmaWeatherAdapter(process.env.KMA_SERVICE_KEY!) : new MockWeatherAdapter());
  const push = config.pushMode === 'expo' ? new ExpoPushSender(process.env.EXPO_ACCESS_TOKEN) : new MockPushSender();
  return { db, config, weather, push, now: opts.now ?? (() => new Date()) };
}
