import 'server-only';
import {
  AppError,
  auth,
  createContext,
  notifications,
  rateLimit,
  reservations,
  weather,
  type Actor,
  type Ctx,
} from '@cheong/server';

// 개발 서버 HMR 에도 DB 연결(PGlite)이 하나만 유지되도록 globalThis 에 보관
const g = globalThis as unknown as { __cheongCtx?: Promise<Ctx>; __cheongTickAt?: number; __cheongTicking?: boolean };

export function getCtx(): Promise<Ctx> {
  if (!g.__cheongCtx) {
    g.__cheongCtx = createContext().catch((e) => {
      g.__cheongCtx = undefined;
      throw e;
    });
  }
  return g.__cheongCtx;
}

/**
 * 주기 작업: 날씨 갱신(10분 이상 지난 지역), 승인 지연 만료, 방문 알림, 알림 발송.
 * 운영에서는 외부 스케줄러가 POST /api/v1/jobs/tick 을 호출한다 (CRON_SECRET).
 * 개발 모드에서는 요청이 들어올 때 최대 1분에 한 번 자동 실행한다.
 */
export async function runTick(ctx: Ctx) {
  const regions = await weather.refreshStaleRegions(ctx);
  const expired = await reservations.expirePendingReservations(ctx);
  const reminded = await reservations.remindUpcoming(ctx);
  const sent = await notifications.dispatchNotifications(ctx);
  return { regions, expired, reminded, sent };
}

export async function maybeTick(ctx: Ctx) {
  if (process.env.DISABLE_AUTO_TICK === 'true') return;
  const now = Date.now();
  if (g.__cheongTicking || (g.__cheongTickAt && now - g.__cheongTickAt < 60_000)) return;
  g.__cheongTicking = true;
  g.__cheongTickAt = now;
  try {
    await runTick(ctx);
  } catch (e) {
    console.error('[tick] 실패', e);
  } finally {
    g.__cheongTicking = false;
  }
}

export const SESSION_COOKIE = 'cg_session';

export function tokenFrom(req: Request): { token: string | null; via: 'cookie' | 'bearer' | null } {
  const h = req.headers.get('authorization');
  if (h?.startsWith('Bearer ')) return { token: h.slice(7).trim(), via: 'bearer' };
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return m ? { token: decodeURIComponent(m.slice(SESSION_COOKIE.length + 1)), via: 'cookie' } : { token: null, via: null };
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

export async function actorFrom(ctx: Ctx, req: Request): Promise<Actor | null> {
  const { token } = tokenFrom(req);
  return auth.authenticate(ctx, token, clientIp(req));
}

export function checkRate(key: string, limit: number, windowMs: number) {
  if (!rateLimit(key, limit, windowMs)) throw new AppError('RATE_LIMITED', '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
}

export function allowedOrigins(): string[] {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:8081', 'http://localhost:19006', 'http://127.0.0.1:8081'];
}
