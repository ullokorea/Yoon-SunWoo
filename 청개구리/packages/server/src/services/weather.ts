// 날씨 갱신·판정 서비스

import {
  MODE_COPY,
  distanceMeters,
  evaluateWeather,
  toKmaGrid,
  weatherMode,
  type RegionWeatherState,
  type SafetyState,
  type TyphoonOutlook,
  type WeatherSnapshot,
} from '@cheong/core';
import { audit, requireRole, type Actor, type Ctx } from '../context';
import type { Queryable } from '../db';
import { badRequest, conflict, notFound, validation } from '../errors';
import { MOCK_SCENARIOS, isMockScenario, type RegionRef } from '../weather/adapters';
import { enqueueNotification } from './notifications';

export interface RegionRow {
  id: string;
  name: string;
  nx: number;
  ny: number;
  center_lat: number;
  center_lng: number;
  warning_area_code: string | null;
  rain_state: RegionWeatherState['rain'];
  rain_since: Date | null;
  dry_observation_count: number;
  safety_state: SafetyState;
  safety_since: Date;
  danger_cleared_at: Date | null;
  typhoon: SerializedTyphoon | null;
  manual_typhoon: SerializedTyphoon | null;
  last_snapshot_at: Date | null;
  last_source: 'KMA' | 'MOCK' | null;
  last_fetch_at: Date | null;
  last_fetch_error: string | null;
  mock_scenario: string | null;
}

interface SerializedTyphoon {
  name: string;
  expectedImpactAt: string;
  expectedClearAt: string;
}

const toTyphoon = (t: SerializedTyphoon | null): TyphoonOutlook | null =>
  t ? { name: t.name, expectedImpactAt: new Date(t.expectedImpactAt), expectedClearAt: new Date(t.expectedClearAt) } : null;

const serTyphoon = (t: TyphoonOutlook | null) =>
  t
    ? JSON.stringify({ name: t.name, expectedImpactAt: t.expectedImpactAt.toISOString(), expectedClearAt: t.expectedClearAt.toISOString() })
    : null;

export function rowToState(r: RegionRow): RegionWeatherState {
  return {
    rain: r.rain_state,
    rainSince: r.rain_since,
    dryObservationCount: r.dry_observation_count,
    safety: r.safety_state,
    safetySince: r.safety_since,
    dangerClearedAt: r.danger_cleared_at,
    lastSnapshotAt: r.last_snapshot_at,
    lastSource: r.last_source,
    typhoon: toTyphoon(r.typhoon),
  };
}

export function regionView(r: RegionRow, now: Date) {
  const state = rowToState(r);
  const mode = weatherMode(state);
  return {
    id: r.id,
    name: r.name,
    rain: state.rain,
    safety: state.safety,
    mode,
    copy: MODE_COPY[mode],
    typhoon: state.typhoon,
    lastSnapshotAt: state.lastSnapshotAt,
    source: r.last_source,
    isMock: r.last_source === 'MOCK',
    mockScenario: r.mock_scenario,
    lastFetchError: r.last_fetch_error,
    stale: !state.lastSnapshotAt || now.getTime() - state.lastSnapshotAt.getTime() > 30 * 60_000,
  };
}
export type RegionView = ReturnType<typeof regionView>;

export async function getRegionRow(q: Queryable, id: string): Promise<RegionRow> {
  const [r] = await q.query<RegionRow>(`select * from weather_regions where id = $1`, [id]);
  if (!r) throw notFound('지역을 찾을 수 없어요.');
  return r;
}

export async function listRegions(ctx: Ctx) {
  const rows = await ctx.db.query<RegionRow>(`select * from weather_regions order by name`);
  const now = ctx.now();
  return rows.map((r) => ({ ...regionView(r, now), nx: r.nx, ny: r.ny, lat: r.center_lat, lng: r.center_lng }));
}

/** 좌표에서 가장 가까운 지역 (30km 이내) */
export async function regionForLocation(ctx: Ctx, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw validation('위치 값이 올바르지 않아요.');
  }
  const rows = await ctx.db.query<RegionRow>(`select * from weather_regions`);
  let best: RegionRow | null = null;
  let bestD = Infinity;
  for (const r of rows) {
    const d = distanceMeters({ lat, lng }, { lat: r.center_lat, lng: r.center_lng });
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  if (!best || bestD > 30_000) return null;
  return regionView(best, ctx.now());
}

/** 매장 등록 시: 좌표의 기상청 격자에 해당하는 지역을 찾거나 만든다 */
export async function ensureRegionForPoint(q: Queryable, lat: number, lng: number, name: string): Promise<string> {
  const { nx, ny } = toKmaGrid({ lat, lng });
  const [existing] = await q.query<{ id: string }>(`select id from weather_regions where nx = $1 and ny = $2`, [nx, ny]);
  if (existing) return existing.id;
  const [created] = await q.query<{ id: string }>(
    `insert into weather_regions (name, nx, ny, center_lat, center_lng) values ($1, $2, $3, $4, $5) returning id`,
    [name, nx, ny, lat, lng],
  );
  return created!.id;
}

function toRef(r: RegionRow): RegionRef {
  return { id: r.id, name: r.name, nx: r.nx, ny: r.ny, warningAreaCode: r.warning_area_code, mockScenario: r.mock_scenario };
}

/** 지역 하나의 날씨를 조회해 상태를 갱신한다 */
export async function refreshRegion(ctx: Ctx, regionId: string) {
  const now = ctx.now();
  const row = await getRegionRow(ctx.db, regionId);
  let snapshot: WeatherSnapshot | null = null;
  let fetchError: string | null = null;
  try {
    snapshot = await ctx.weather.fetchSnapshot(toRef(row), now);
    const manual = toTyphoon(row.manual_typhoon);
    if (manual && manual.expectedClearAt > now && !snapshot.typhoon) snapshot = { ...snapshot, typhoon: manual };
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  return ctx.db.tx(async (q) => {
    // 동시에 두 번 갱신되지 않도록 지역 행 잠금
    const [locked] = await q.query<RegionRow>(`select * from weather_regions where id = $1 for update`, [regionId]);
    const prev = rowToState(locked!);
    const t = evaluateWeather(prev, snapshot, now);
    const n = t.next;
    await q.query(
      `update weather_regions set rain_state = $2, rain_since = $3, dry_observation_count = $4, safety_state = $5,
              safety_since = $6, danger_cleared_at = $7, typhoon = $8, last_snapshot_at = $9, last_source = $10,
              last_fetch_at = $11, last_fetch_error = $12, updated_at = $11
        where id = $1`,
      [regionId, n.rain, n.rainSince, n.dryObservationCount, n.safety, n.safetySince, n.dangerClearedAt, serTyphoon(n.typhoon),
        n.lastSnapshotAt, n.lastSource, now, fetchError],
    );
    if (snapshot) {
      await q.query(
        `insert into weather_observations (region_id, observed_at, source, precipitation_type, rainfall_1h, rain_prob_6h, rain_expected_6h, raw)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [regionId, snapshot.observedAt, snapshot.source, snapshot.precipitationType, snapshot.rainfall1h, snapshot.rainProbNext6h,
          snapshot.rainExpectedNext6h, JSON.stringify({ alerts: snapshot.alerts, typhoon: snapshot.typhoon })],
      );
      await syncAlerts(q, regionId, snapshot, now);
    }
    if (t.rainChanged || t.safetyChanged) {
      await q.query(
        `insert into region_weather_history (region_id, prev_rain, next_rain, prev_safety, next_safety, reason, source, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [regionId, prev.rain, n.rain, prev.safety, n.safety, t.reason, snapshot?.source ?? null, now],
      );
      await notifyTransition(q, now, locked!, prev, n);
    }
    return { regionId, prev, next: n, reason: t.reason, fetchError };
  });
}

async function syncAlerts(q: Queryable, regionId: string, s: WeatherSnapshot, now: Date) {
  const active = await q.query<{ id: string; title: string }>(
    `select id, title from weather_alerts where region_id = $1 and cleared_at is null`,
    [regionId],
  );
  const titles = new Set(s.alerts.map((a) => a.title));
  for (const a of active) if (!titles.has(a.title)) await q.query(`update weather_alerts set cleared_at = $2 where id = $1`, [a.id, now]);
  const have = new Set(active.map((a) => a.title));
  for (const a of s.alerts) {
    if (have.has(a.title)) continue;
    await q.query(
      `insert into weather_alerts (region_id, kind, level, title, source, issued_at) values ($1, $2, $3, $4, $5, $6)`,
      [regionId, a.kind, a.level, a.title, s.source, a.issuedAt],
    );
  }
}

/** 상태 전환에 따른 알림 (소비자·점주) */
async function notifyTransition(q: Queryable, now: Date, region: RegionRow, prev: RegionWeatherState, next: RegionWeatherState) {
  const owners = await q.query<{ user_id: string; store_id: string; store_name: string }>(
    `select so.user_id, s.id as store_id, s.name as store_name from stores s join store_owners so on so.store_id = s.id
      where s.region_id = $1 and s.status = 'APPROVED'`,
    [region.id],
  );
  const residents = await q.query<{ user_id: string }>(
    `select distinct user_id from (
       select p.user_id from user_profiles p where p.home_region_id = $1
       union select f.user_id from favorites f join stores s on s.id = f.store_id where s.region_id = $1 and f.notify
     ) t`,
    [region.id],
  );
  const day = now.toISOString().slice(0, 10);
  const toOwners = (type: string, title: string, body: string) =>
    Promise.all(owners.map((o) => enqueueNotification(q, now, { userId: o.user_id, type, category: 'owner', title, body, data: { storeId: o.store_id }, dedupeKey: `${type}:${o.store_id}:${day}:${next.safetySince.toISOString()}` })));
  const toResidents = (type: string, category: 'rain' | 'typhoon', title: string, body: string) =>
    Promise.all(residents.map((r) => enqueueNotification(q, now, { userId: r.user_id, type, category, title, body, data: { regionId: region.id } })));

  if (next.safety !== prev.safety) {
    if (next.safety === 'TYPHOON_WATCH') {
      await toOwners('OWNER_TYPHOON_SETUP', '태풍 특가를 준비해 보세요', `${region.name}에 태풍 접근 예보가 있어요. 태풍 전·후 안전한 방문 시간대의 특가를 등록할 수 있어요.`);
      await toResidents('TYPHOON_PREVIEW', 'typhoon', '개굴이의 태풍 특가 예고 🐸', '태풍이 지나간 뒤 이용할 수 있는 특가를 미리 예약해 보세요.');
    } else if (next.safety === 'DANGER') {
      await toOwners('OWNER_SAFETY_BLOCK', '안전을 위해 신규 예약이 중단됐어요', `${region.name}에 기상특보가 발효되어 신규 방문 예약을 자동으로 멈췄어요.`);
      const upcoming = await q.query<{ user_id: string; id: string; code: string }>(
        `select r.user_id, r.id, r.code from reservations r join stores s on s.id = r.store_id
          where s.region_id = $1 and r.status in ('PENDING', 'CONFIRMED') and r.slot_start_at > $2`,
        [region.id, now],
      );
      for (const r of upcoming) {
        await enqueueNotification(q, now, {
          userId: r.user_id,
          type: 'RESERVATION_SAFETY',
          category: 'reservation',
          title: '기상 위험으로 예약 확인이 필요해요',
          body: `예약 ${r.code} 지역에 기상특보가 발효됐어요. 무리한 외출은 피하시고, 앱에서 무료로 취소할 수 있어요.`,
          data: { reservationId: r.id },
          dedupeKey: `safety:${r.id}`,
        });
      }
    } else if (next.safety === 'RECOVERY') {
      await toOwners('OWNER_REOPEN_CHECK', '영업 재개 여부를 알려주세요', '특보가 해제됐어요. 매장이 안전하게 영업 중이라면 "영업 재개 확인"을 눌러 회복 특가를 열어 주세요.');
    }
  }
  if (next.rain !== prev.rain && next.safety !== 'DANGER' && next.safety !== 'UNKNOWN') {
    if (next.rain === 'RAINING') {
      await toOwners('OWNER_RAIN_ON', '우천 할인이 자동으로 시작됐어요', '비가 와요! 자동 활성화로 설정한 우천 할인이 열렸어요.');
      await toResidents('RAIN_START', 'rain', '비가 와요! 오늘의 할인이 열렸어요 ☔', `${region.name} 주변 매장의 우천 할인을 확인해 보세요.`);
    } else if (next.rain === 'FORECAST' && prev.rain === 'CLEAR') {
      await toOwners('OWNER_RAIN_FORECAST', '비 예보가 있어요', '곧 비가 올 예정이에요. 우천 할인 설정과 예약 가능 수량을 확인해 주세요.');
    } else if (prev.rain === 'RAINING') {
      await toOwners('OWNER_RAIN_OFF', '우천 할인이 종료됐어요', '비가 그쳐 신규 우천 할인 예약을 마감했어요. 이미 확정된 예약은 그대로 유지돼요.');
    }
  }
}

export async function refreshAllRegions(ctx: Ctx) {
  const rows = await ctx.db.query<{ id: string }>(`select id from weather_regions`);
  const results = [];
  for (const r of rows) results.push(await refreshRegion(ctx, r.id));
  return results;
}

/** 오래된 지역만 갱신 (조회 시 지연 갱신용, 10분 간격) */
export async function refreshStaleRegions(ctx: Ctx, maxAgeMs = 10 * 60_000) {
  const rows = await ctx.db.query<{ id: string }>(
    `select id from weather_regions where last_fetch_at is null or last_fetch_at < $1`,
    [new Date(ctx.now().getTime() - maxAgeMs)],
  );
  for (const r of rows) await refreshRegion(ctx, r.id);
  return rows.length;
}

// ---------------- 관리자 ----------------

export async function setMockScenario(ctx: Ctx, actor: Actor | null, regionId: string, scenario: string) {
  const a = requireRole(actor, 'admin');
  if (ctx.config.weatherSource !== 'mock') throw badRequest('실제 기상청 연동 모드에서는 Mock 시나리오를 사용할 수 없어요.');
  if (!isMockScenario(scenario)) throw validation('알 수 없는 시나리오예요.', Object.keys(MOCK_SCENARIOS));
  await getRegionRow(ctx.db, regionId);
  await ctx.db.query(`update weather_regions set mock_scenario = $2 where id = $1`, [regionId, scenario]);
  await audit(ctx.db, a, 'WEATHER_MOCK_SCENARIO', 'weather_region', regionId, { scenario });
  return refreshRegion(ctx, regionId);
}

/**
 * 운영자 안전 판정.
 * - DANGER: 특보와 무관한 현장 위험(침수 등)을 수동 지정
 * - RECOVERY: 특보 해제 후 현장 안전을 사람이 확인한 경우, 유예 시간 전이라도 회복 단계로 전환
 *   (최근 스냅샷에 위험 특보가 남아있으면 거부)
 */
export async function adminSetSafety(ctx: Ctx, actor: Actor | null, regionId: string, target: 'DANGER' | 'RECOVERY', reason: string) {
  const a = requireRole(actor, 'admin');
  if (!reason?.trim()) throw validation('판단 근거를 입력해 주세요.');
  const now = ctx.now();
  return ctx.db.tx(async (q) => {
    const [r] = await q.query<RegionRow>(`select * from weather_regions where id = $1 for update`, [regionId]);
    if (!r) throw notFound('지역을 찾을 수 없어요.');
    if (target === 'RECOVERY') {
      if (r.safety_state !== 'DANGER') throw conflict('위험 상태인 지역만 회복 단계로 전환할 수 있어요.');
      if (!r.danger_cleared_at) throw conflict('기상특보가 아직 해제되지 않았어요. 특보 해제가 확인된 뒤 전환할 수 있어요.');
    }
    await q.query(
      `update weather_regions set safety_state = $2, safety_since = $3, danger_cleared_at = null, updated_at = $3 where id = $1`,
      [regionId, target, now],
    );
    await q.query(
      `insert into region_weather_history (region_id, prev_rain, next_rain, prev_safety, next_safety, reason, source, created_at)
       values ($1, $2, $2, $3, $4, $5, 'MANUAL', $6)`,
      [regionId, r.rain_state, r.safety_state, target, `[운영자] ${reason.trim()}`, now],
    );
    await audit(q, a, 'WEATHER_SAFETY_OVERRIDE', 'weather_region', regionId, { from: r.safety_state, to: target, reason });
    await notifyTransition(q, now, r, rowToState(r), { ...rowToState(r), safety: target, safetySince: now });
    return regionView((await q.query<RegionRow>(`select * from weather_regions where id = $1`, [regionId]))[0]!, now);
  });
}

/** 운영자가 기상청 태풍 발표를 보고 영향 예상 시각을 입력 */
export async function setManualTyphoon(
  ctx: Ctx,
  actor: Actor | null,
  regionIds: string[],
  outlook: { name: string; expectedImpactAt: string; expectedClearAt: string } | null,
) {
  const a = requireRole(actor, 'admin');
  let value: string | null = null;
  if (outlook) {
    const impact = new Date(outlook.expectedImpactAt);
    const clear = new Date(outlook.expectedClearAt);
    if (!outlook.name?.trim() || Number.isNaN(impact.getTime()) || Number.isNaN(clear.getTime()) || clear <= impact) {
      throw validation('태풍 이름과 영향 시작·종료 예상 시각을 올바르게 입력해 주세요.');
    }
    value = serTyphoon({ name: outlook.name.trim(), expectedImpactAt: impact, expectedClearAt: clear });
  }
  for (const id of regionIds) {
    await ctx.db.query(`update weather_regions set manual_typhoon = $2 where id = $1`, [id, value]);
    await audit(ctx.db, a, 'WEATHER_TYPHOON_OUTLOOK', 'weather_region', id, { outlook });
  }
  for (const id of regionIds) await refreshRegion(ctx, id);
}

export async function regionHistory(ctx: Ctx, regionId: string, limit = 30) {
  return ctx.db.query(
    `select prev_rain as "prevRain", next_rain as "nextRain", prev_safety as "prevSafety", next_safety as "nextSafety",
            reason, source, created_at as "createdAt"
       from region_weather_history where region_id = $1 order by created_at desc limit $2`,
    [regionId, limit],
  );
}

export async function activeAlerts(ctx: Ctx, regionId: string) {
  return ctx.db.query(
    `select kind, level, title, source, issued_at as "issuedAt" from weather_alerts
      where region_id = $1 and cleared_at is null order by issued_at desc`,
    [regionId],
  );
}
