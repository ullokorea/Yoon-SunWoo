// 날씨 데이터 어댑터
// - KmaWeatherAdapter: 공공데이터포털 기상청 API (KMA_SERVICE_KEY 필요)
// - MockWeatherAdapter: 개발용 시나리오 (모든 결과에 source='MOCK' 표시)

import type { AlertKind, AlertLevel, TyphoonOutlook, WeatherAlert, WeatherSnapshot } from '@cheong/core';
import { HOUR, MINUTE, kstDate, kstTime } from '@cheong/core';

export interface RegionRef {
  id: string;
  name: string;
  nx: number;
  ny: number;
  warningAreaCode: string | null;
  mockScenario: string | null;
}

export interface WeatherAdapter {
  readonly source: 'KMA' | 'MOCK';
  fetchSnapshot(region: RegionRef, now: Date): Promise<AdapterSnapshot>;
}

export type AdapterSnapshot = WeatherSnapshot & { kmaBaseAt?: Date | null };

// ------------------------------------------------------------------
// Mock
// ------------------------------------------------------------------

export const MOCK_SCENARIOS = {
  clear: '맑음',
  rain_forecast: '비 예보',
  raining: '비 내림',
  heavy_rain_warning: '호우경보 (위험)',
  typhoon_watch: '태풍 접근 예보',
  typhoon_warning: '태풍경보 발효 (위험)',
  after_typhoon: '태풍 특보 해제 (안전 확인 대기)',
  api_failure: '기상 API 장애',
} as const;
export type MockScenario = keyof typeof MOCK_SCENARIOS;

export function isMockScenario(v: unknown): v is MockScenario {
  return typeof v === 'string' && v in MOCK_SCENARIOS;
}

export class MockWeatherAdapter implements WeatherAdapter {
  readonly source = 'MOCK' as const;

  async fetchSnapshot(region: RegionRef, now: Date): Promise<AdapterSnapshot> {
    const scenario: MockScenario = isMockScenario(region.mockScenario) ? region.mockScenario : 'clear';
    if (scenario === 'api_failure') throw new Error('[MOCK] 기상 API 응답 없음 (시나리오)');
    const base: WeatherSnapshot = {
      observedAt: now,
      source: 'MOCK',
      precipitationType: 0,
      rainfall1h: 0,
      rainProbNext6h: 10,
      rainExpectedNext6h: false,
      alerts: [],
      typhoon: null,
    };
    const typhoon: TyphoonOutlook = {
      name: '[MOCK] 샘플태풍',
      expectedImpactAt: new Date(now.getTime() + 30 * HOUR),
      expectedClearAt: new Date(now.getTime() + 42 * HOUR),
    };
    const alert = (kind: AlertKind, level: AlertLevel, title: string): WeatherAlert => ({
      kind,
      level,
      title: `[MOCK] ${title}`,
      issuedAt: new Date(now.getTime() - 10 * MINUTE),
    });
    switch (scenario) {
      case 'clear':
      case 'after_typhoon':
        return base;
      case 'rain_forecast':
        return { ...base, rainProbNext6h: 80, rainExpectedNext6h: true };
      case 'raining':
        return { ...base, precipitationType: 1, rainfall1h: 2.5, rainProbNext6h: 90, rainExpectedNext6h: true };
      case 'heavy_rain_warning':
        return {
          ...base,
          precipitationType: 1,
          rainfall1h: 35,
          rainProbNext6h: 100,
          rainExpectedNext6h: true,
          alerts: [alert('HEAVY_RAIN', 'WARNING', `${region.name} 호우경보`)],
        };
      case 'typhoon_watch':
        return {
          ...base,
          rainProbNext6h: 40,
          typhoon,
          alerts: [alert('TYPHOON', 'PRELIMINARY', `${region.name} 태풍 예비특보`)],
        };
      case 'typhoon_warning':
        return {
          ...base,
          precipitationType: 1,
          rainfall1h: 20,
          rainProbNext6h: 100,
          rainExpectedNext6h: true,
          typhoon,
          alerts: [alert('TYPHOON', 'WARNING', `${region.name} 태풍경보`)],
        };
    }
  }
}

// ------------------------------------------------------------------
// 기상청 (공공데이터포털)
// ------------------------------------------------------------------
// 사용 API
//  1) 단기예보 조회서비스 VilageFcstInfoService_2.0
//     - getUltraSrtNcst  초단기실황 (PTY, RN1)
//     - getUltraSrtFcst  초단기예보 (향후 6시간 PTY)
//  2) 기상특보 조회서비스 WthrWrnInfoService
//     - getWthrWrnMsg    기상특보 통보문 (t6: 특보 발효 현황, t7: 예비특보 발효 현황)
//
// ⚠️ 이 어댑터는 실제 서비스 키로 검증되지 않았다. 키 발급 후 docs/운영-체크리스트.md 의
//    "기상청 연동 검증" 항목을 반드시 수행할 것. 특보 응답을 해석하지 못하면 예외를 던지고,
//    상태 머신은 이를 장애로 처리해 보수적으로 신규 예약을 제한한다.

const KMA_BASE = 'https://apis.data.go.kr/1360000';

type KmaItem = Record<string, string | number>;

export class KmaWeatherAdapter implements WeatherAdapter {
  readonly source = 'KMA' as const;
  constructor(
    private serviceKey: string,
    private fetchImpl: typeof fetch = fetch,
    private timeoutMs = 8000,
  ) {}

  async fetchSnapshot(region: RegionRef, now: Date): Promise<AdapterSnapshot> {
    const [ncst, fcst, alerts] = await Promise.all([
      this.ultraNowcast(region, now),
      this.ultraForecast(region, now),
      this.alerts(region, now),
    ]);
    const pty = Number(ncst.find((i) => i.category === 'PTY')?.obsrValue ?? NaN);
    const rn1 = Number(ncst.find((i) => i.category === 'RN1')?.obsrValue ?? NaN);
    if (Number.isNaN(pty)) throw new Error('KMA 초단기실황 응답에 PTY 가 없습니다.');
    const rainExpected = fcst.some((i) => i.category === 'PTY' && String(i.fcstValue) !== '0');
    return {
      // 신선도 판정은 '수신 시각' 기준 (실황 발표 시각은 최대 ~100분 전이라 기준으로 쓰면 항상 오래된 데이터가 됨)
      observedAt: now,
      kmaBaseAt: kmaBaseDateTime(ncst[0]),
      source: 'KMA',
      precipitationType: pty,
      rainfall1h: Number.isNaN(rn1) ? 0 : rn1,
      rainProbNext6h: null,
      rainExpectedNext6h: rainExpected,
      alerts,
      // 태풍 영향 예상 시각은 통보문에서 신뢰성 있게 추출하기 어려워 운영자 입력(manual_typhoon)을 사용한다.
      typhoon: null,
    };
  }

  private async call(path: string, params: Record<string, string>): Promise<KmaItem[]> {
    const qs = new URLSearchParams({ pageNo: '1', numOfRows: '100', dataType: 'JSON', ...params });
    // serviceKey 는 이미 URL 인코딩된 형태로 발급되는 경우가 있어 그대로 붙인다.
    const url = `${KMA_BASE}/${path}?serviceKey=${this.serviceKey}&${qs.toString()}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
      const text = await res.text();
      let json: { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: KmaItem[] } } } };
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`KMA 응답 파싱 실패 (XML 오류 응답일 수 있음): ${text.slice(0, 120)}`);
      }
      const code = json.response?.header?.resultCode;
      if (code === '03') return []; // NO_DATA
      if (code !== '00') throw new Error(`KMA 오류 ${code}: ${json.response?.header?.resultMsg}`);
      return json.response?.body?.items?.item ?? [];
    } finally {
      clearTimeout(timer);
    }
  }

  private ultraNowcast(r: RegionRef, now: Date) {
    // 매시 정시 발표, 약 40분 후 제공
    const t = new Date(now.getTime() - 40 * MINUTE);
    return this.call('VilageFcstInfoService_2.0/getUltraSrtNcst', {
      base_date: kstDate(t).replace(/-/g, ''),
      base_time: `${kstTime(t).slice(0, 2)}00`,
      nx: String(r.nx),
      ny: String(r.ny),
    });
  }

  private ultraForecast(r: RegionRef, now: Date) {
    // 매시 30분 발표, 약 45분 후 제공
    const t = new Date(now.getTime() - 45 * MINUTE);
    return this.call('VilageFcstInfoService_2.0/getUltraSrtFcst', {
      base_date: kstDate(t).replace(/-/g, ''),
      base_time: `${kstTime(t).slice(0, 2)}30`,
      nx: String(r.nx),
      ny: String(r.ny),
    });
  }

  private async alerts(r: RegionRef, now: Date): Promise<WeatherAlert[]> {
    if (!r.warningAreaCode) {
      throw new Error(`${r.name}: 특보 구역(warning_area_code)이 설정되지 않아 특보를 판정할 수 없습니다.`);
    }
    // warning_area_code 형식: "<지점번호>:<구역 키워드>" 예) "159:부산"
    const [stnId, keyword] = r.warningAreaCode.split(':');
    if (!stnId || !keyword) throw new Error(`${r.name}: warning_area_code 형식 오류 (예: 159:부산)`);
    const from = new Date(now.getTime() - 3 * 24 * HOUR);
    const items = await this.call('WthrWrnInfoService/getWthrWrnMsg', {
      stnId,
      fromTmFc: kstDate(from).replace(/-/g, ''),
      toTmFc: kstDate(now).replace(/-/g, ''),
    });
    if (items.length === 0) return []; // 최근 통보문 없음 = 발효 특보 없음
    const latest = [...items].sort((a, b) => String(b.tmFc).localeCompare(String(a.tmFc)))[0]!;
    const current = String(latest.t6 ?? '');
    const prelim = String(latest.t7 ?? '');
    if (!('t6' in latest)) throw new Error('KMA 특보 통보문 형식을 해석할 수 없습니다 (t6 없음).');
    return [...parseAlertText(current, keyword, false, now), ...parseAlertText(prelim, keyword, true, now)];
  }
}

const ALERT_WORDS: Array<[RegExp, AlertKind]> = [
  [/태풍/, 'TYPHOON'],
  [/강풍/, 'WIND'],
  [/호우/, 'HEAVY_RAIN'],
  [/폭풍해일/, 'STORM_SURGE'],
];

/**
 * 특보 현황 텍스트 파싱. 예)
 *  "o 태풍경보 : 부산, 울산, 경상남도(거제, ...)\no 강풍주의보 : ..."
 * 해당 구역 키워드가 포함된 줄만 본다.
 */
export function parseAlertText(text: string, keyword: string, preliminary: boolean, now: Date): WeatherAlert[] {
  const out: WeatherAlert[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(keyword)) continue;
    const head = line.split(':')[0] ?? '';
    for (const [re, kind] of ALERT_WORDS) {
      if (!re.test(head)) continue;
      const level: AlertLevel = preliminary ? 'PRELIMINARY' : /경보/.test(head) ? 'WARNING' : 'ADVISORY';
      out.push({ kind, level, title: head.replace(/^[o\s·-]+/, '').trim(), issuedAt: now });
    }
  }
  return out;
}

function kmaBaseDateTime(item: KmaItem | undefined): Date | null {
  if (!item?.baseDate || !item.baseTime) return null;
  const d = String(item.baseDate);
  const t = String(item.baseTime).padStart(4, '0');
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:00+09:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
