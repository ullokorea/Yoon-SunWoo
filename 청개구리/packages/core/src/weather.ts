// 날씨 판정 상태 머신
//
// 지역 단위로 (강수 상태, 안전 상태) 두 축을 관리한다.
// - 강수: 깜빡임 방지를 위해 RAINING 최소 유지 시간 + 연속 무강수 관측 횟수 조건
// - 안전: 위험 진입은 즉시, 해제는 유예 시간 후 RECOVERY 로 (보수적)
// - 데이터 장애: 마지막 정상 데이터가 오래되면 UNKNOWN (신규 예약 제한)

import { HOUR, MINUTE } from './time';
import type {
  RainState,
  RegionWeatherState,
  SafetyState,
  WeatherAlert,
  WeatherMode,
  WeatherSnapshot,
} from './types';

export interface WeatherPolicy {
  /** RAINING 진입 후 최소 유지 시간 */
  minRainHoldMs: number;
  /** RAINING 해제에 필요한 연속 무강수 관측 횟수 */
  dryObservationsToStop: number;
  /** 비 예보로 판단하는 강수확률 기준 (%) */
  forecastProbThreshold: number;
  /** 데이터가 이 시간보다 오래되면 UNKNOWN */
  staleAfterMs: number;
  /** 특보 해제 후 RECOVERY 로 넘어가기까지 유예 시간 */
  dangerClearGraceMs: number;
  /** RECOVERY 유지 시간 */
  recoveryDurationMs: number;
}

export const DEFAULT_WEATHER_POLICY: WeatherPolicy = {
  minRainHoldMs: 60 * MINUTE,
  dryObservationsToStop: 2,
  forecastProbThreshold: 60,
  staleAfterMs: 30 * MINUTE,
  dangerClearGraceMs: 6 * HOUR,
  recoveryDurationMs: 72 * HOUR,
};

/** 강수로 보는 PTY 코드: 비, 비/눈, 소나기, 빗방울, 빗방울눈날림 */
const RAIN_PTY = new Set([1, 2, 4, 5, 6]);
const DANGER_KINDS = new Set(['TYPHOON', 'WIND', 'HEAVY_RAIN', 'STORM_SURGE', 'FLOOD']);

export function isRainingNow(s: WeatherSnapshot): boolean {
  return RAIN_PTY.has(s.precipitationType) || s.rainfall1h >= 0.1;
}

export function isDangerAlert(a: WeatherAlert): boolean {
  return DANGER_KINDS.has(a.kind) && (a.level === 'ADVISORY' || a.level === 'WARNING');
}

export function initialRegionState(now: Date): RegionWeatherState {
  return {
    rain: 'CLEAR',
    rainSince: null,
    dryObservationCount: 0,
    safety: 'UNKNOWN',
    safetySince: now,
    dangerClearedAt: null,
    lastSnapshotAt: null,
    lastSource: null,
    typhoon: null,
  };
}

export interface Transition {
  next: RegionWeatherState;
  rainChanged: boolean;
  safetyChanged: boolean;
  reason: string;
}

/**
 * 새 스냅샷(또는 조회 실패 시 null)을 반영해 다음 상태를 계산한다.
 * 순수 함수 — 부수효과 없음.
 */
export function evaluateWeather(
  prev: RegionWeatherState,
  snapshot: WeatherSnapshot | null,
  now: Date,
  policy: WeatherPolicy = DEFAULT_WEATHER_POLICY,
): Transition {
  const reasons: string[] = [];
  const next: RegionWeatherState = { ...prev };

  const fresh = snapshot !== null && now.getTime() - snapshot.observedAt.getTime() <= policy.staleAfterMs;

  if (!fresh) {
    // 조회 실패 또는 오래된 데이터. 마지막 정상 데이터가 아직 유효하면 상태를 유지한다.
    const last = prev.lastSnapshotAt?.getTime();
    const lastStillValid = last !== undefined && now.getTime() - last <= policy.staleAfterMs;
    if (!lastStillValid && prev.safety !== 'DANGER' && prev.safety !== 'UNKNOWN') {
      next.safety = 'UNKNOWN';
      next.safetySince = now;
      reasons.push('기상 데이터 갱신 실패로 판정 불가 — 신규 예약을 보수적으로 제한');
    } else if (prev.safety === 'DANGER') {
      reasons.push('기상 데이터 갱신 실패 — 위험 상태 유지');
    } else {
      reasons.push('기상 데이터 갱신 실패 — 직전 정상 데이터로 상태 유지');
    }
    return finish(prev, next, reasons);
  }

  next.lastSnapshotAt = snapshot.observedAt;
  next.lastSource = snapshot.source;
  next.typhoon = snapshot.typhoon;

  // ---- 강수 축 ----
  const rainingNow = isRainingNow(snapshot);
  const forecast =
    snapshot.rainExpectedNext6h ||
    (snapshot.rainProbNext6h !== null && snapshot.rainProbNext6h >= policy.forecastProbThreshold);

  if (rainingNow) {
    if (prev.rain !== 'RAINING') {
      next.rain = 'RAINING';
      next.rainSince = now;
      reasons.push(`강수 관측 (PTY=${snapshot.precipitationType}, RN1=${snapshot.rainfall1h}mm)`);
    }
    next.dryObservationCount = 0;
  } else if (prev.rain === 'RAINING') {
    const dry = prev.dryObservationCount + 1;
    const held = prev.rainSince ? now.getTime() - prev.rainSince.getTime() : Infinity;
    if (dry >= policy.dryObservationsToStop && held >= policy.minRainHoldMs) {
      next.rain = forecast ? 'FORECAST' : 'CLEAR';
      next.rainSince = null;
      next.dryObservationCount = 0;
      reasons.push(`연속 ${dry}회 무강수 관측 — 우천 할인 모드 종료`);
    } else {
      next.dryObservationCount = dry;
      reasons.push(`무강수 관측 ${dry}회 — 최소 유지 조건 충족 전까지 RAINING 유지`);
    }
  } else {
    const r: RainState = forecast ? 'FORECAST' : 'CLEAR';
    if (r !== prev.rain) reasons.push(r === 'FORECAST' ? '6시간 내 비 예보' : '강수 없음');
    next.rain = r;
    next.dryObservationCount = 0;
  }

  // ---- 안전 축 ----
  const danger = snapshot.alerts.filter(isDangerAlert);
  const typhoonPrelim = snapshot.alerts.some((a) => a.kind === 'TYPHOON' && a.level === 'PRELIMINARY');
  const typhoonApproaching = snapshot.typhoon !== null || typhoonPrelim;

  let safety: SafetyState;
  if (danger.length > 0) {
    safety = 'DANGER';
    next.dangerClearedAt = null;
    if (prev.safety !== 'DANGER') reasons.push(`기상특보 발효: ${danger.map((a) => a.title).join(', ')}`);
  } else if (prev.safety === 'DANGER') {
    const clearedAt = prev.dangerClearedAt ?? now;
    next.dangerClearedAt = clearedAt;
    if (now.getTime() - clearedAt.getTime() >= policy.dangerClearGraceMs) {
      safety = 'RECOVERY';
      next.dangerClearedAt = null;
      reasons.push('특보 해제 후 유예 시간 경과 — 회복 단계 (점주 영업 재개 확인 필요)');
    } else {
      safety = 'DANGER';
      if (!prev.dangerClearedAt) reasons.push('특보 해제 확인 — 안전 확인 유예 시간 동안 위험 상태 유지');
    }
  } else if (typhoonApproaching) {
    safety = 'TYPHOON_WATCH';
    if (prev.safety !== 'TYPHOON_WATCH') reasons.push(`태풍 접근 예보${snapshot.typhoon ? `: ${snapshot.typhoon.name}` : ''}`);
  } else if (prev.safety === 'RECOVERY' && now.getTime() - prev.safetySince.getTime() < policy.recoveryDurationMs) {
    safety = 'RECOVERY';
  } else {
    safety = 'NORMAL';
    if (prev.safety !== 'NORMAL') reasons.push(prev.safety === 'UNKNOWN' ? '기상 데이터 정상 수신' : '안전 상태 정상');
  }

  if (safety !== prev.safety) {
    next.safety = safety;
    next.safetySince = now;
  }

  return finish(prev, next, reasons);
}

function finish(prev: RegionWeatherState, next: RegionWeatherState, reasons: string[]): Transition {
  return {
    next,
    rainChanged: prev.rain !== next.rain,
    safetyChanged: prev.safety !== next.safety,
    reason: reasons.join(' / ') || '변화 없음',
  };
}

/** 화면용 종합 모드 */
export function weatherMode(s: Pick<RegionWeatherState, 'rain' | 'safety'>): WeatherMode {
  switch (s.safety) {
    case 'DANGER':
      return 'DANGER';
    case 'UNKNOWN':
      return 'UNKNOWN';
    case 'TYPHOON_WATCH':
      return 'TYPHOON_WATCH';
    case 'RECOVERY':
      return 'RECOVERY';
    default:
      return s.rain === 'RAINING' ? 'RAINING' : s.rain === 'FORECAST' ? 'RAIN_FORECAST' : 'CLEAR';
  }
}

export type CharacterPose = 'resting' | 'preparing' | 'jumping' | 'sheltering' | 'cheering' | 'thinking';

export interface ModeCopy {
  mode: WeatherMode;
  headline: string;
  sub: string;
  pose: CharacterPose;
  bookingOpen: boolean;
}

export const MODE_COPY: Record<WeatherMode, ModeCopy> = {
  CLEAR: {
    mode: 'CLEAR',
    headline: '개굴이가 비를 기다리고 있어요.',
    sub: '비가 오면 주변 매장의 할인이 열려요. 미리 둘러보고 알림을 받아보세요.',
    pose: 'resting',
    bookingOpen: false,
  },
  RAIN_FORECAST: {
    mode: 'RAIN_FORECAST',
    headline: '곧 혜택이 쏟아질 예정이에요!',
    sub: '비 소식이 있어요. 관심 매장에 할인 알림을 신청해 두세요.',
    pose: 'preparing',
    bookingOpen: false,
  },
  RAINING: {
    mode: 'RAINING',
    headline: '비가 와요! 오늘의 할인이 열렸어요.',
    sub: '지금 주변 매장의 우천 할인을 예약할 수 있어요.',
    pose: 'jumping',
    bookingOpen: true,
  },
  TYPHOON_WATCH: {
    mode: 'TYPHOON_WATCH',
    headline: '태풍이 예고되면, 할인도 커진다!',
    sub: '태풍 전 안전한 시간대와 태풍이 지나간 뒤 방문을 미리 예약할 수 있어요.',
    pose: 'sheltering',
    bookingOpen: true,
  },
  DANGER: {
    mode: 'DANGER',
    headline: '지금은 외출하지 마세요.',
    sub: '기상특보가 발효 중이라 신규 방문 예약을 잠시 멈췄어요. 혜택은 태풍이 지나간 뒤 이용할 수 있어요.',
    pose: 'sheltering',
    bookingOpen: false,
  },
  RECOVERY: {
    mode: 'RECOVERY',
    headline: '태풍이 지나갔어요. 동네 가게를 응원해요!',
    sub: '영업을 다시 시작한 매장의 회복 특가를 예약할 수 있어요.',
    pose: 'cheering',
    bookingOpen: true,
  },
  UNKNOWN: {
    mode: 'UNKNOWN',
    headline: '날씨를 확인하고 있어요.',
    sub: '기상 정보를 받지 못해 안전을 위해 신규 예약을 잠시 멈췄어요.',
    pose: 'thinking',
    bookingOpen: false,
  },
};
