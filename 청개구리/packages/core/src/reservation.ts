// 예약 상태 전이 규칙

import { MINUTE } from './time';
import type { ReservationStatus, Role } from './types';

export type ReservationAction =
  | 'APPROVE'
  | 'REJECT'
  | 'CANCEL_BY_USER'
  | 'CANCEL_BY_STORE'
  | 'CANCEL_SAFETY'
  | 'VISIT'
  | 'NO_SHOW'
  | 'EXPIRE';

interface Rule {
  from: ReservationStatus[];
  to: ReservationStatus;
  actors: Array<Role | 'system'>;
  /** 슬롯 좌석을 되돌리는가 */
  releasesSeats: boolean;
}

export const RESERVATION_RULES: Record<ReservationAction, Rule> = {
  APPROVE: { from: ['PENDING'], to: 'CONFIRMED', actors: ['owner'], releasesSeats: false },
  REJECT: { from: ['PENDING'], to: 'REJECTED', actors: ['owner'], releasesSeats: true },
  CANCEL_BY_USER: { from: ['PENDING', 'CONFIRMED'], to: 'CANCELLED_BY_USER', actors: ['consumer'], releasesSeats: true },
  CANCEL_BY_STORE: { from: ['PENDING', 'CONFIRMED'], to: 'CANCELLED_BY_STORE', actors: ['owner', 'admin'], releasesSeats: true },
  CANCEL_SAFETY: {
    from: ['PENDING', 'CONFIRMED'],
    to: 'CANCELLED_SAFETY',
    actors: ['consumer', 'owner', 'admin', 'system'],
    releasesSeats: true,
  },
  VISIT: { from: ['CONFIRMED'], to: 'VISITED', actors: ['owner'], releasesSeats: false },
  NO_SHOW: { from: ['CONFIRMED'], to: 'NO_SHOW', actors: ['owner'], releasesSeats: false },
  EXPIRE: { from: ['PENDING'], to: 'EXPIRED', actors: ['system'], releasesSeats: true },
};

/** 승인 대기 만료 시간 */
export const PENDING_EXPIRY_MS = 30 * MINUTE;
/** QR 방문 확인 허용 구간: 시작 60분 전 ~ 시작 120분 후 */
export const VISIT_WINDOW_BEFORE_MS = 60 * MINUTE;
export const VISIT_WINDOW_AFTER_MS = 120 * MINUTE;
/** 노쇼 처리 가능 시점: 시작 30분 후 */
export const NO_SHOW_AFTER_MS = 30 * MINUTE;

export type TransitionCheck = { ok: true; to: ReservationStatus } | { ok: false; message: string };

export function checkTransition(
  action: ReservationAction,
  current: ReservationStatus,
  actor: Role | 'system',
  ctx: { slotStartAt: Date; createdAt: Date; now: Date },
): TransitionCheck {
  const rule = RESERVATION_RULES[action];
  if (!rule.actors.includes(actor)) return { ok: false, message: '이 작업을 할 권한이 없어요.' };
  if (!rule.from.includes(current)) return { ok: false, message: `현재 상태(${STATUS_LABEL[current]})에서는 할 수 없는 작업이에요.` };

  const t = ctx.now.getTime();
  const start = ctx.slotStartAt.getTime();
  switch (action) {
    case 'CANCEL_BY_USER':
      if (t >= start) return { ok: false, message: '방문 시간이 지난 예약은 취소할 수 없어요.' };
      break;
    case 'APPROVE':
      if (t >= start || t - ctx.createdAt.getTime() >= PENDING_EXPIRY_MS) {
        return { ok: false, message: '승인 가능 시간이 지난 예약이에요.' };
      }
      break;
    case 'VISIT':
      if (t < start - VISIT_WINDOW_BEFORE_MS) return { ok: false, message: '아직 방문 확인 가능 시간이 아니에요. (방문 1시간 전부터)' };
      if (t > start + VISIT_WINDOW_AFTER_MS) return { ok: false, message: '방문 확인 가능 시간이 지났어요.' };
      break;
    case 'NO_SHOW':
      if (t < start + NO_SHOW_AFTER_MS) return { ok: false, message: '방문 시간 30분 후부터 노쇼 처리할 수 있어요.' };
      break;
    case 'EXPIRE':
      if (t - ctx.createdAt.getTime() < PENDING_EXPIRY_MS && t < start) return { ok: false, message: '아직 만료 시간이 아니에요.' };
      break;
  }
  return { ok: true, to: rule.to };
}

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING: '승인 대기',
  CONFIRMED: '예약 확정',
  VISITED: '방문 완료',
  REJECTED: '거절됨',
  EXPIRED: '승인 시간 만료',
  CANCELLED_BY_USER: '취소 (고객)',
  CANCELLED_BY_STORE: '취소 (매장)',
  CANCELLED_SAFETY: '취소 (기상 안전)',
  NO_SHOW: '노쇼',
};

/** 소비자 앱 예약 내역 탭 분류 */
export function reservationTab(s: ReservationStatus): 'upcoming' | 'visited' | 'cancelled' | 'noshow' {
  if (s === 'PENDING' || s === 'CONFIRMED') return 'upcoming';
  if (s === 'VISITED') return 'visited';
  if (s === 'NO_SHOW') return 'noshow';
  return 'cancelled';
}

/** 사람이 읽기 쉬운 예약번호: CG-XXXXXX (혼동 문자 제외) */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function formatReservationCode(randomBytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[(randomBytes[i] ?? 0) % CODE_ALPHABET.length];
  return `CG-${s}`;
}

/** 사업자등록번호 체크섬 검증 (국세청 규칙). 진위 확인은 아님. */
export function isValidBusinessNumber(raw: string): boolean {
  const d = raw.replace(/-/g, '');
  if (!/^\d{10}$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i]!;
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}
