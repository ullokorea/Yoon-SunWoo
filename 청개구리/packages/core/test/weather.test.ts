import { describe, expect, it } from 'vitest';
import { evaluateWeather, initialRegionState, weatherMode, HOUR, MINUTE } from '../src';
import type { RegionWeatherState, WeatherSnapshot } from '../src';

const T0 = new Date('2026-07-10T03:00:00Z'); // KST 12:00
const at = (min: number) => new Date(T0.getTime() + min * MINUTE);

function snap(over: Partial<WeatherSnapshot> & { at: Date }): WeatherSnapshot {
  return {
    observedAt: over.at,
    source: 'MOCK',
    precipitationType: 0,
    rainfall1h: 0,
    rainProbNext6h: 10,
    rainExpectedNext6h: false,
    alerts: [],
    typhoon: null,
    ...over,
  };
}

function run(states: Array<[number, Partial<WeatherSnapshot> | null]>, start?: RegionWeatherState) {
  let s = start ?? initialRegionState(at(-1));
  const out: RegionWeatherState[] = [];
  for (const [min, partial] of states) {
    const now = at(min);
    s = evaluateWeather(s, partial === null ? null : snap({ at: now, ...partial }), now).next;
    out.push(s);
  }
  return out;
}

describe('날씨 상태 머신 — 강수', () => {
  it('정상 수신 시 UNKNOWN → NORMAL/CLEAR', () => {
    const [s] = run([[0, {}]]);
    expect(s!.safety).toBe('NORMAL');
    expect(weatherMode(s!)).toBe('CLEAR');
  });

  it('강수확률 60% 이상이면 비 예보', () => {
    const [s] = run([[0, { rainProbNext6h: 70 }]]);
    expect(weatherMode(s!)).toBe('RAIN_FORECAST');
  });

  it('PTY=1 이면 즉시 RAINING', () => {
    const [, s] = run([[0, {}], [10, { precipitationType: 1, rainfall1h: 1.5 }]]);
    expect(s!.rain).toBe('RAINING');
    expect(weatherMode(s!)).toBe('RAINING');
  });

  it('비가 잠깐 그쳐도 최소 60분 + 연속 2회 무강수 전까지 RAINING 유지 (깜빡임 방지)', () => {
    const r = run([
      [0, { precipitationType: 1 }],
      [10, {}], // 무강수 1회
      [20, {}], // 무강수 2회지만 60분 미만
      [30, { precipitationType: 1 }], // 다시 비 → 카운트 리셋
      [40, {}],
      [70, {}], // 2회 + 70분 경과 → 해제
    ]);
    expect(r.map((s) => s.rain)).toEqual(['RAINING', 'RAINING', 'RAINING', 'RAINING', 'RAINING', 'CLEAR']);
  });

  it('비 그친 뒤에도 예보가 있으면 FORECAST 로 내려간다', () => {
    const r = run([
      [0, { precipitationType: 1 }],
      [60, { rainExpectedNext6h: true }],
      [70, { rainExpectedNext6h: true }],
    ]);
    expect(r[2]!.rain).toBe('FORECAST');
  });

  it('RN1 0.1mm 이상이면 PTY 없어도 강수로 본다', () => {
    const [s] = run([[0, { rainfall1h: 0.2 }]]);
    expect(s!.rain).toBe('RAINING');
  });
});

describe('날씨 상태 머신 — API 장애', () => {
  it('일시적 실패는 직전 상태 유지, 30분 넘게 실패하면 UNKNOWN', () => {
    const r = run([
      [0, { precipitationType: 1 }],
      [10, null],
      [25, null],
      [40, null],
    ]);
    expect(r[1]!.safety).toBe('NORMAL');
    expect(r[2]!.safety).toBe('NORMAL');
    expect(r[3]!.safety).toBe('UNKNOWN');
    expect(weatherMode(r[3]!)).toBe('UNKNOWN');
  });

  it('오래된 관측 시각의 데이터는 실패로 취급', () => {
    let s = initialRegionState(at(0));
    s = evaluateWeather(s, snap({ at: at(-120), precipitationType: 1 }), at(0)).next;
    expect(s.safety).toBe('UNKNOWN');
    expect(s.rain).toBe('CLEAR');
  });

  it('위험 상태에서 장애가 나도 위험 상태 유지 (해제하지 않음)', () => {
    const r = run([
      [0, { alerts: [{ kind: 'TYPHOON', level: 'WARNING', title: '태풍경보', issuedAt: at(0) }] }],
      [60, null],
    ]);
    expect(r[1]!.safety).toBe('DANGER');
  });

  it('장애 복구 후 정상 수신되면 다시 판정', () => {
    const r = run([[0, {}], [40, null], [50, { precipitationType: 1 }]]);
    expect(r[1]!.safety).toBe('UNKNOWN');
    expect(r[2]!.safety).toBe('NORMAL');
    expect(r[2]!.rain).toBe('RAINING');
  });
});

describe('날씨 상태 머신 — 태풍', () => {
  const typhoon = { name: '샘플태풍', expectedImpactAt: at(48 * 60), expectedClearAt: at(60 * 60) };
  const warning = { kind: 'TYPHOON' as const, level: 'WARNING' as const, title: '태풍경보', issuedAt: T0 };

  it('태풍 접근 예보 → TYPHOON_WATCH', () => {
    const [s] = run([[0, { typhoon }]]);
    expect(s!.safety).toBe('TYPHOON_WATCH');
  });

  it('특보 발효 → 즉시 DANGER, 해제 후 6시간 유예 뒤 RECOVERY', () => {
    const r = run([
      [0, { typhoon }],
      [60, { typhoon, alerts: [warning] }],
      [120, {}], // 해제 확인 — 유예 시작
      [120 + 5 * 60, {}], // 5시간 — 아직 DANGER
      [120 + 6 * 60, {}], // 6시간 — RECOVERY
    ]);
    expect(r.map((s) => s.safety)).toEqual(['TYPHOON_WATCH', 'DANGER', 'DANGER', 'DANGER', 'RECOVERY']);
  });

  it('유예 중 특보가 다시 발효되면 유예 리셋', () => {
    const r = run([
      [0, { alerts: [warning] }],
      [60, {}],
      [120, { alerts: [warning] }],
      [60 + 6 * 60, {}],
    ]);
    expect(r[3]!.safety).toBe('DANGER');
  });

  it('강풍 주의보도 위험으로 본다, 예비특보는 위험 아님', () => {
    const [a] = run([[0, { alerts: [{ kind: 'WIND', level: 'ADVISORY', title: '강풍주의보', issuedAt: T0 }] }]]);
    expect(a!.safety).toBe('DANGER');
    const [b] = run([[0, { alerts: [{ kind: 'TYPHOON', level: 'PRELIMINARY', title: '태풍 예비특보', issuedAt: T0 }] }]]);
    expect(b!.safety).toBe('TYPHOON_WATCH');
  });

  it('RECOVERY 는 72시간 후 NORMAL', () => {
    const recovery: RegionWeatherState = {
      ...initialRegionState(T0),
      safety: 'RECOVERY',
      safetySince: T0,
      lastSnapshotAt: T0,
    };
    const r = run([[71 * 60, {}], [73 * 60, {}]], recovery);
    expect(r[0]!.safety).toBe('RECOVERY');
    expect(r[1]!.safety).toBe('NORMAL');
  });

  it('위험 상태에서는 비가 와도 화면 모드는 DANGER', () => {
    const [s] = run([[0, { precipitationType: 1, alerts: [warning] }]]);
    expect(s!.rain).toBe('RAINING');
    expect(weatherMode(s!)).toBe('DANGER');
  });

  it('상태 전환 시각 기록', () => {
    const r = run([[0, {}], [10, { typhoon }]]);
    expect(r[1]!.safetySince.getTime()).toBe(at(10).getTime());
    expect(HOUR).toBe(60 * MINUTE);
  });
});
