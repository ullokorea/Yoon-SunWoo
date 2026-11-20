// 청개구리 도메인 공통 타입

export type Role = 'consumer' | 'owner' | 'admin';

/** 강수 상태 (지역 단위) */
export type RainState = 'CLEAR' | 'FORECAST' | 'RAINING';

/** 안전 상태 (지역 단위). 강수 상태보다 우선한다. */
export type SafetyState = 'NORMAL' | 'TYPHOON_WATCH' | 'DANGER' | 'RECOVERY' | 'UNKNOWN';

/** 화면에 보여줄 종합 모드 */
export type WeatherMode =
  | 'CLEAR'
  | 'RAIN_FORECAST'
  | 'RAINING'
  | 'TYPHOON_WATCH'
  | 'DANGER'
  | 'RECOVERY'
  | 'UNKNOWN';

export type DataSource = 'KMA' | 'MOCK';

export type AlertKind = 'TYPHOON' | 'WIND' | 'HEAVY_RAIN' | 'STORM_SURGE' | 'FLOOD' | 'OTHER';
/** PRELIMINARY = 예비특보, ADVISORY = 주의보, WARNING = 경보 */
export type AlertLevel = 'PRELIMINARY' | 'ADVISORY' | 'WARNING';

export interface WeatherAlert {
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  issuedAt: Date;
}

export interface TyphoonOutlook {
  name: string;
  /** 해당 지역 영향 예상 시작 시각 */
  expectedImpactAt: Date;
  /** 해당 지역 영향 예상 종료 시각 */
  expectedClearAt: Date;
}

/** 날씨 어댑터가 지역 하나에 대해 돌려주는 관측·예보 스냅샷 */
export interface WeatherSnapshot {
  observedAt: Date;
  source: DataSource;
  /** 기상청 강수형태 PTY 코드 (0 없음, 1 비, 2 비/눈, 3 눈, 4 소나기, 5 빗방울, 6 빗방울눈날림, 7 눈날림) */
  precipitationType: number;
  /** 1시간 강수량 mm */
  rainfall1h: number;
  /** 향후 6시간 최대 강수확률 (%) — 없으면 null */
  rainProbNext6h: number | null;
  /** 향후 6시간 내 강수형태 예보 존재 여부 */
  rainExpectedNext6h: boolean;
  alerts: WeatherAlert[];
  typhoon: TyphoonOutlook | null;
}

/** 지역의 현재 판정 상태 (DB weather_regions 행과 대응) */
export interface RegionWeatherState {
  rain: RainState;
  rainSince: Date | null;
  dryObservationCount: number;
  safety: SafetyState;
  safetySince: Date;
  /** DANGER 상태에서 특보가 해제된 것을 처음 확인한 시각 */
  dangerClearedAt: Date | null;
  lastSnapshotAt: Date | null;
  lastSource: DataSource | null;
  typhoon: TyphoonOutlook | null;
}

export type CampaignKind = 'RAIN' | 'TYPHOON_PRE' | 'TYPHOON_RECOVERY';
export type CampaignScope = 'ALL' | 'MENUS';
export type CampaignStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface Campaign {
  id: string;
  storeId: string;
  kind: CampaignKind;
  title: string;
  /** 할인율 (%) 정수 */
  rate: number;
  scope: CampaignScope;
  menuIds: string[];
  /** 하루 중 적용 시간 'HH:MM' (KST) */
  dailyStartTime: string;
  dailyEndTime: string;
  validFrom: Date;
  validUntil: Date;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  maxPartySize: number;
  /** 하루 최대 할인 예약 건수 (선착순) — null 이면 무제한 */
  dailyLimit: number | null;
  autoActivate: boolean;
  paused: boolean;
  status: CampaignStatus;
}

export interface Menu {
  id: string;
  storeId: string;
  name: string;
  price: number;
  isSet: boolean;
  isAvailable: boolean;
}

export type StoreStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

/** 요일별 영업시간: index 0 = 일요일. null = 휴무 */
export type BusinessHours = Array<{ open: string; close: string } | null>;

export interface StoreForBooking {
  id: string;
  status: StoreStatus;
  /** 점주가 일시적으로 영업을 중단했는지 */
  operationPaused: boolean;
  /** 태풍 이후 점주가 영업 재개를 확인한 시각 */
  reopenConfirmedAt: Date | null;
  businessHours: BusinessHours;
  autoApprove: boolean;
}

export interface Slot {
  id: string;
  storeId: string;
  startAt: Date;
  durationMinutes: number;
  capacity: number;
  booked: number;
  closed: boolean;
}

export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'VISITED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED_BY_USER'
  | 'CANCELLED_BY_STORE'
  | 'CANCELLED_SAFETY'
  | 'NO_SHOW';

export const ACTIVE_RESERVATION_STATUSES: ReservationStatus[] = ['PENDING', 'CONFIRMED'];
