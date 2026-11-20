import { AppError } from '@cheong/server';
import { match, pathExists, type Result } from '@/lib/router';
import { actorFrom, allowedOrigins, getCtx, maybeTick, runTick, SESSION_COOKIE, tokenFrom } from '@/lib/server';

// 모든 API 는 요청마다 실행 (캐시 없음)
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(req), ...extra },
  });
}

function sessionCookie(token: string | null, expiresAt?: Date) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (!token) return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt!.toUTCString()}${secure}`;
}

async function handle(method: string, req: Request, { params }: Ctx) {
  const { path } = await params;
  const url = new URL(req.url);

  try {
    // 주기 작업 (외부 스케줄러용)
    if (method === 'POST' && path.join('/') === 'jobs/tick') {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return json(req, { error: { code: 'UNAUTHORIZED', message: 'CRON_SECRET 이 필요합니다.' } }, 401);
      }
      return json(req, { data: await runTick(await getCtx()) });
    }

    const m = match(method, path);
    if (!m) {
      return pathExists(path)
        ? json(req, { error: { code: 'METHOD_NOT_ALLOWED', message: '지원하지 않는 메서드예요.' } }, 405)
        : json(req, { error: { code: 'NOT_FOUND', message: 'API 를 찾을 수 없어요.' } }, 404);
    }

    // 쿠키 인증 + 상태 변경 요청은 같은 출처에서만 (CSRF 방지). Bearer 토큰(앱)은 제외.
    const { via } = tokenFrom(req);
    if (method !== 'GET' && via === 'cookie') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) {
        return json(req, { error: { code: 'FORBIDDEN', message: '허용되지 않은 요청 출처예요.' } }, 403);
      }
    }

    let body: Record<string, unknown> = {};
    if (method !== 'GET' && method !== 'DELETE') {
      const text = await req.text();
      if (text.length > 100_000) return json(req, { error: { code: 'BAD_REQUEST', message: '요청이 너무 커요.' } }, 413);
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
          else throw new Error();
        } catch {
          return json(req, { error: { code: 'BAD_REQUEST', message: 'JSON 형식이 올바르지 않아요.' } }, 400);
        }
      }
    }

    const ctx = await getCtx();
    if (ctx.config.env !== 'production') await maybeTick(ctx);
    const actor = await actorFrom(ctx, req);
    const out = await m.handler({ ctx, req, actor, params: m.params, query: url.searchParams, body });

    // 핸들러가 { data, status?, setSession? } 형태(그 키만)를 돌려준 경우에만 Result 로 본다.
    // (예약 객체처럼 status 필드를 가진 일반 데이터를 HTTP 상태로 오인하지 않도록)
    const RESULT_KEYS = ['data', 'status', 'setSession'];
    const isResult =
      out !== null &&
      typeof out === 'object' &&
      !Array.isArray(out) &&
      ('data' in out || 'setSession' in out) &&
      Object.keys(out).every((k) => RESULT_KEYS.includes(k)) &&
      (!('status' in out) || typeof (out as { status: unknown }).status === 'number');
    const r: Result = isResult ? (out as Result) : { data: out };
    const extra: Record<string, string> = {};
    if (r.setSession !== undefined) extra['set-cookie'] = sessionCookie(r.setSession?.token ?? null, r.setSession?.expiresAt);
    return json(req, { data: r.data ?? null }, r.status ?? 200, extra);
  } catch (e) {
    if (e instanceof AppError) {
      return json(req, { error: { code: e.code, message: e.message, detail: e.detail ?? null } }, e.status);
    }
    console.error('[api] 처리되지 않은 오류', e);
    return json(req, { error: { code: 'INTERNAL', message: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' } }, 500);
  }
}

export const GET = (req: Request, c: Ctx) => handle('GET', req, c);
export const POST = (req: Request, c: Ctx) => handle('POST', req, c);
export const PATCH = (req: Request, c: Ctx) => handle('PATCH', req, c);
export const DELETE = (req: Request, c: Ctx) => handle('DELETE', req, c);
export const OPTIONS = (req: Request) => new Response(null, { status: 204, headers: corsHeaders(req) });
