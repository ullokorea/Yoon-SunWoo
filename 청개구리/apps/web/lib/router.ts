import 'server-only';
import {
  AppError,
  auth,
  campaigns,
  notifications,
  reservations,
  stats,
  stores,
  weather,
  MOCK_SCENARIOS,
  type Actor,
  type Ctx,
} from '@cheong/server';
import { checkRate, clientIp } from './server';

export interface ReqCtx {
  ctx: Ctx;
  req: Request;
  actor: Actor | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

export interface Result {
  data?: unknown;
  status?: number;
  setSession?: { token: string; expiresAt: Date } | null;
}

type Handler = (r: ReqCtx) => Promise<Result | unknown>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const routes: Array<{ method: Method; pattern: string[]; handler: Handler }> = [];
const on = (method: Method, path: string, handler: Handler) => routes.push({ method, pattern: path.split('/').filter(Boolean), handler });

export function match(method: string, segments: string[]) {
  for (const r of routes) {
    if (r.method !== method || r.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.pattern.length; i++) {
      const p = r.pattern[i]!;
      const s = segments[i]!;
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
      else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

export function pathExists(segments: string[]) {
  return routes.some((r) => r.pattern.length === segments.length && r.pattern.every((p, i) => p.startsWith(':') || p === segments[i]));
}

const num = (v: string | null) => (v === null || v === '' ? undefined : Number(v));
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => v === true || v === 'true';

// ---------- 공통 ----------
on('GET', 'health', async ({ ctx }) => ({
  ok: true,
  env: ctx.config.env,
  db: ctx.db.kind,
  weatherSource: ctx.config.weatherSource,
  pushMode: ctx.config.pushMode,
  mockScenarios: ctx.config.weatherSource === 'mock' ? MOCK_SCENARIOS : null,
}));

// ---------- 인증 ----------
on('POST', 'auth/signup', async ({ ctx, req, body }) => {
  checkRate(`signup:${clientIp(req)}`, 10, 60 * 60_000);
  const s = await auth.signup(ctx, {
    email: String(body.email ?? ''),
    password: String(body.password ?? ''),
    nickname: String(body.nickname ?? ''),
    role: body.role === 'owner' ? 'owner' : 'consumer',
    agreeTerms: bool(body.agreeTerms),
    agreePrivacy: bool(body.agreePrivacy),
    agreeLocation: bool(body.agreeLocation),
    agreeMarketing: bool(body.agreeMarketing),
  });
  return { data: { token: s.token, user: s.user }, setSession: s, status: 201 };
});
on('POST', 'auth/login', async ({ ctx, req, body }) => {
  const email = String(body.email ?? '').toLowerCase();
  checkRate(`login:${clientIp(req)}`, 20, 10 * 60_000);
  checkRate(`login-email:${email}`, 8, 10 * 60_000);
  const s = await auth.login(ctx, email, String(body.password ?? ''));
  return { data: { token: s.token, user: s.user }, setSession: s };
});
on('POST', 'auth/logout', async ({ ctx, req }) => {
  const h = req.headers.get('authorization');
  const cookie = req.headers.get('cookie')?.match(/cg_session=([^;]+)/)?.[1];
  const token = h?.startsWith('Bearer ') ? h.slice(7) : cookie ? decodeURIComponent(cookie) : null;
  if (token) await auth.logout(ctx, token);
  return { data: { ok: true }, setSession: null };
});
on('GET', 'me', async ({ ctx, actor }) => (actor ? auth.getMe(ctx, actor.userId) : null));
on('PATCH', 'me', async ({ ctx, actor, body }) =>
  auth.updateProfile(ctx, actor, {
    nickname: str(body.nickname),
    phone: body.phone === null ? null : str(body.phone),
    homeRegionId: body.homeRegionId === null ? null : str(body.homeRegionId),
    locationConsent: typeof body.locationConsent === 'boolean' ? body.locationConsent : undefined,
  }),
);
on('POST', 'me/withdraw', async ({ ctx, actor, body }) => {
  await auth.withdraw(ctx, actor, String(body.password ?? ''));
  return { data: { ok: true }, setSession: null };
});

// ---------- 날씨·지역 ----------
on('GET', 'regions', async ({ ctx }) => weather.listRegions(ctx));
on('GET', 'regions/locate', async ({ ctx, query }) => weather.regionForLocation(ctx, Number(query.get('lat')), Number(query.get('lng'))));

// ---------- 소비자 ----------
on('GET', 'stores', async ({ ctx, actor, query }) =>
  stores.listStores(
    ctx,
    {
      lat: num(query.get('lat')),
      lng: num(query.get('lng')),
      regionId: query.get('regionId') || undefined,
      sort: query.get('sort') === 'discount' ? 'discount' : 'distance',
      category: query.get('category') || undefined,
      priceLevel: num(query.get('priceLevel')),
      availableOnly: query.get('availableOnly') === 'true',
    },
    actor,
  ),
);
on('GET', 'stores/:id', async ({ ctx, actor, params }) => stores.getStoreDetail(ctx, params.id!, actor));
on('POST', 'stores/:id/favorite', async ({ ctx, actor, params, body }) => {
  await stores.setFavorite(ctx, actor, params.id!, bool(body.on), body.notify === undefined ? true : bool(body.notify));
  return { ok: true };
});
on('GET', 'favorites', async ({ ctx, actor, query }) => stores.listFavorites(ctx, actor, num(query.get('lat')), num(query.get('lng'))));

on('POST', 'reservations/quote', async ({ ctx, actor, body }) => reservations.quoteReservation(ctx, actor, body as never));
on('POST', 'reservations', async ({ ctx, actor, body }) => {
  if (actor) checkRate(`reserve:${actor.userId}`, 20, 60 * 60_000);
  return { data: await reservations.createReservation(ctx, actor, body as never), status: 201 };
});
on('GET', 'reservations', async ({ ctx, actor }) => reservations.listMyReservations(ctx, actor));
on('GET', 'reservations/:id', async ({ ctx, actor, params }) => reservations.getReservation(ctx, actor, params.id!));
on('POST', 'reservations/:id/cancel', async ({ ctx, actor, params, body }) => reservations.cancelByUser(ctx, actor, params.id!, str(body.reason)));

on('GET', 'notifications', async ({ ctx, actor }) => notifications.listMyNotifications(ctx, actor));
on('POST', 'notifications/read', async ({ ctx, actor }) => {
  await notifications.markNotificationsRead(ctx, actor);
  return { ok: true };
});
on('GET', 'notification-preferences', async ({ ctx, actor }) => notifications.getPreferences(ctx, actor));
on('PATCH', 'notification-preferences', async ({ ctx, actor, body }) => notifications.updatePreferences(ctx, actor, body as never));
on('POST', 'reports', async ({ ctx, actor, body }) => stats.createReport(ctx, actor, body as never));

// ---------- 점주 ----------
on('GET', 'owner/stores', async ({ ctx, actor }) => stores.listOwnerStores(ctx, actor));
on('POST', 'owner/stores', async ({ ctx, actor, body }) => ({ data: await stores.createStore(ctx, actor, body as never), status: 201 }));
on('GET', 'owner/stores/:id', async ({ ctx, actor, params }) => stores.getOwnerStore(ctx, actor, params.id!));
on('PATCH', 'owner/stores/:id', async ({ ctx, actor, params, body }) => stores.updateStore(ctx, actor, params.id!, body as never));
on('POST', 'owner/stores/:id/pause', async ({ ctx, actor, params, body }) => {
  await stores.setOperationPaused(ctx, actor, params.id!, bool(body.paused));
  return { ok: true };
});
on('POST', 'owner/stores/:id/reopen', async ({ ctx, actor, params }) => {
  await stores.confirmReopen(ctx, actor, params.id!);
  return { ok: true };
});
on('POST', 'owner/stores/:id/menus', async ({ ctx, actor, params, body }) => stores.createMenu(ctx, actor, params.id!, body as never));
on('PATCH', 'owner/stores/:id/menus/:menuId', async ({ ctx, actor, params, body }) => stores.updateMenu(ctx, actor, params.id!, params.menuId!, body as never));
on('DELETE', 'owner/stores/:id/menus/:menuId', async ({ ctx, actor, params }) => {
  await stores.deleteMenu(ctx, actor, params.id!, params.menuId!);
  return { ok: true };
});
on('GET', 'owner/stores/:id/slots', async ({ ctx, actor, params, query }) => {
  const from = query.get('from') ? new Date(query.get('from')!) : ctx.now();
  return stores.listOwnerSlots(ctx, actor, params.id!, from, Number(query.get('days') ?? 7));
});
on('POST', 'owner/stores/:id/slots/generate', async ({ ctx, actor, params, body }) => stores.generateSlots(ctx, actor, params.id!, body as never));
on('POST', 'owner/stores/:id/slots/:slotId/close', async ({ ctx, actor, params, body }) => {
  await stores.setSlotClosed(ctx, actor, params.id!, params.slotId!, bool(body.closed));
  return { ok: true };
});
on('GET', 'owner/stores/:id/campaigns', async ({ ctx, actor, params }) => campaigns.listStoreCampaigns(ctx, actor, params.id!));
on('POST', 'owner/stores/:id/campaigns', async ({ ctx, actor, params, body }) => ({
  data: await campaigns.createCampaign(ctx, actor, params.id!, body as never),
  status: 201,
}));
on('PATCH', 'owner/stores/:id/campaigns/:cid', async ({ ctx, actor, params, body }) => campaigns.updateCampaign(ctx, actor, params.id!, params.cid!, body as never));
on('POST', 'owner/stores/:id/campaigns/:cid/pause', async ({ ctx, actor, params, body }) => {
  await campaigns.setCampaignPaused(ctx, actor, params.id!, params.cid!, bool(body.paused));
  return { ok: true };
});
on('GET', 'owner/stores/:id/reservations', async ({ ctx, actor, params, query }) =>
  reservations.listStoreReservations(ctx, actor, params.id!, { date: query.get('date') || undefined, status: query.get('status') || undefined }),
);
on('GET', 'owner/stores/:id/reservations/:rid', async ({ ctx, actor, params }) => {
  const r = await reservations.getReservation(ctx, actor, params.rid!);
  if (r.store.id !== params.id) throw new AppError('NOT_FOUND', '예약을 찾을 수 없어요.');
  return r;
});
on('POST', 'owner/stores/:id/reservations/:rid/action', async ({ ctx, actor, params, body }) =>
  reservations.ownerAction(ctx, actor, params.id!, params.rid!, body.action as never, str(body.reason)),
);
on('POST', 'owner/stores/:id/verify', async ({ ctx, actor, params, body }) => {
  if (actor) checkRate(`verify:${actor.userId}`, 60, 60_000);
  return reservations.verifyVisit(ctx, actor, params.id!, { token: str(body.token), code: str(body.code) });
});
on('GET', 'owner/stores/:id/dashboard', async ({ ctx, actor, params }) => stats.ownerDashboard(ctx, actor, params.id!));
on('GET', 'owner/stores/:id/stats', async ({ ctx, actor, params, query }) => stats.ownerStats(ctx, actor, params.id!, Number(query.get('days') ?? 30)));

// ---------- 관리자 ----------
on('GET', 'admin/overview', async ({ ctx, actor }) => stats.adminOverview(ctx, actor));
on('GET', 'admin/stores', async ({ ctx, actor, query }) => stores.adminListStores(ctx, actor, query.get('status') || undefined));
on('POST', 'admin/stores/:id/review', async ({ ctx, actor, params, body }) => {
  await stores.adminReviewStore(ctx, actor, params.id!, body.decision as never, str(body.note));
  return { ok: true };
});
on('GET', 'admin/campaigns', async ({ ctx, actor, query }) => campaigns.adminListCampaigns(ctx, actor, query.get('status') || undefined));
on('POST', 'admin/campaigns/:id/review', async ({ ctx, actor, params, body }) => {
  await campaigns.adminReviewCampaign(ctx, actor, params.id!, body.decision as never, str(body.note));
  return { ok: true };
});
on('GET', 'admin/reservations', async ({ ctx, actor, query }) => reservations.adminListReservations(ctx, actor, query.get('status') || undefined));
on('GET', 'admin/users', async ({ ctx, actor }) => stats.adminUsers(ctx, actor));
on('POST', 'admin/users/:id/status', async ({ ctx, actor, params, body }) => {
  await stats.adminSetUserStatus(ctx, actor, params.id!, body.status as never, String(body.reason ?? ''));
  return { ok: true };
});
on('GET', 'admin/anomalies', async ({ ctx, actor }) => stats.adminAnomalies(ctx, actor));
on('GET', 'admin/audit-logs', async ({ ctx, actor, query }) => stats.adminAuditLogs(ctx, actor, Number(query.get('limit') ?? 100)));
on('GET', 'admin/reports', async ({ ctx, actor }) => stats.adminReports(ctx, actor));
on('POST', 'admin/reports/:id', async ({ ctx, actor, params, body }) => {
  await stats.adminUpdateReport(ctx, actor, params.id!, String(body.status ?? ''), str(body.note));
  return { ok: true };
});
on('GET', 'admin/regions/:id', async ({ ctx, actor, params }) => {
  if (!actor?.roles.includes('admin')) throw new AppError('FORBIDDEN', '접근 권한이 없어요.');
  return { history: await weather.regionHistory(ctx, params.id!), alerts: await weather.activeAlerts(ctx, params.id!) };
});
on('POST', 'admin/regions/:id/mock', async ({ ctx, actor, params, body }) => weather.setMockScenario(ctx, actor, params.id!, String(body.scenario ?? '')));
on('POST', 'admin/regions/:id/safety', async ({ ctx, actor, params, body }) =>
  weather.adminSetSafety(ctx, actor, params.id!, body.target === 'DANGER' ? 'DANGER' : 'RECOVERY', String(body.reason ?? '')),
);
on('POST', 'admin/regions/typhoon', async ({ ctx, actor, body }) => {
  await weather.setManualTyphoon(ctx, actor, (body.regionIds as string[]) ?? [], (body.outlook as never) ?? null);
  return { ok: true };
});
on('POST', 'admin/weather/refresh', async ({ ctx, actor }) => {
  if (!actor?.roles.includes('admin')) throw new AppError('FORBIDDEN', '접근 권한이 없어요.');
  const r = await weather.refreshAllRegions(ctx);
  await notifications.dispatchNotifications(ctx);
  return r.map((x) => ({ regionId: x.regionId, rain: x.next.rain, safety: x.next.safety, reason: x.reason, fetchError: x.fetchError }));
});
