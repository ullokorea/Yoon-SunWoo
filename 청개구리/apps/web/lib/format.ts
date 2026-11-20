const KST = 9 * 3600_000;
const k = (d: string | Date) => new Date(new Date(d).getTime() + KST);
const pad = (n: number) => String(n).padStart(2, '0');

export const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;
export const kstDay = (d: string | Date) => k(d).toISOString().slice(0, 10);
export const hm = (d: string | Date) => `${pad(k(d).getUTCHours())}:${pad(k(d).getUTCMinutes())}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const md = (d: string | Date) => `${k(d).getUTCMonth() + 1}월 ${k(d).getUTCDate()}일 (${WD[k(d).getUTCDay()]})`;
export const dt = (d: string | Date) => `${md(d)} ${hm(d)}`;
export const todayKst = () => kstDay(new Date());
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
