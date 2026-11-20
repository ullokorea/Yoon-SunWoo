// 한국 표준시(KST, UTC+9, 서머타임 없음) 기준 시간 유틸

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

function shifted(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** KST 기준 'YYYY-MM-DD' */
export function kstDate(date: Date): string {
  return shifted(date).toISOString().slice(0, 10);
}

/** KST 기준 'HH:MM' */
export function kstTime(date: Date): string {
  return shifted(date).toISOString().slice(11, 16);
}

/** KST 기준 요일 (0 = 일요일) */
export function kstWeekday(date: Date): number {
  return shifted(date).getUTCDay();
}

/** KST 기준 자정부터 지난 분 */
export function kstMinutesOfDay(date: Date): number {
  const d = shifted(date);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 'HH:MM' → 분. 24:00 허용 */
export function parseHHMM(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`잘못된 시간 형식: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`잘못된 시간 값: ${value}`);
  return h * 60 + min;
}

export function isValidHHMM(value: string): boolean {
  try {
    parseHHMM(value);
    return true;
  } catch {
    return false;
  }
}

/** KST 날짜('YYYY-MM-DD') + 시간('HH:MM') → Date */
export function kstDateTime(date: string, time: string): Date {
  const minutes = parseHHMM(time);
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) throw new Error(`잘못된 날짜: ${date}`);
  return new Date(base + minutes * MINUTE - KST_OFFSET_MS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE);
}
