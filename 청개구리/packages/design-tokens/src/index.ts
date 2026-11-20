// 청개구리 디자인 토큰 — 소비자 앱(React Native)과 웹(Tailwind)에서 공유

import { colors } from './colors';
export { colors };

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const font = {
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, hero: 34 },
  weight: { regular: '400', medium: '500', bold: '700', heavy: '800' },
} as const;

/** 최소 터치 영역 (WCAG 2.5.5 / 플랫폼 가이드) */
export const touch = { min: 44 } as const;

export type WeatherModeKey = 'CLEAR' | 'RAIN_FORECAST' | 'RAINING' | 'TYPHOON_WATCH' | 'DANGER' | 'RECOVERY' | 'UNKNOWN';

/** 날씨 모드별 배경·강조색 */
export const modeTheme: Record<WeatherModeKey, { bg: string; accent: string; label: string; emoji: string }> = {
  CLEAR: { bg: '#EAF7F0', accent: colors.green, label: '맑음', emoji: '☀️' },
  RAIN_FORECAST: { bg: '#EAF1FD', accent: colors.rain, label: '비 예보', emoji: '🌦️' },
  RAINING: { bg: '#DDEBFF', accent: colors.rain, label: '비 오는 중', emoji: '🌧️' },
  TYPHOON_WATCH: { bg: colors.typhoonBg, accent: colors.typhoon, label: '태풍 접근', emoji: '🌀' },
  DANGER: { bg: colors.dangerBg, accent: colors.danger, label: '기상 위험', emoji: '⚠️' },
  RECOVERY: { bg: '#FFF6D8', accent: '#C99A00', label: '태풍 회복', emoji: '🌈' },
  UNKNOWN: { bg: '#F1F3F2', accent: colors.muted, label: '확인 중', emoji: '❔' },
};
export * from './frog';
