import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** 화면에 들어올 때마다 다시 불러오는 데이터 훅 */
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!path) return;
      const id = ++seq.current;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      try {
        const d = await api<T>(path);
        if (id === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { data, error, loading, refreshing, reload: () => load('refresh'), setData };
}

const KST = 9 * 3600_000;
const k = (d: string | Date) => new Date(new Date(d).getTime() + KST);
const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;
export const hm = (d: string | Date) => `${pad(k(d).getUTCHours())}:${pad(k(d).getUTCMinutes())}`;
export const md = (d: string | Date) => `${k(d).getUTCMonth() + 1}/${k(d).getUTCDate()}(${WD[k(d).getUTCDay()]})`;
export const dayKey = (d: string | Date) => k(d).toISOString().slice(0, 10);
export const dt = (d: string | Date) => `${md(d)} ${hm(d)}`;
export const isToday = (d: string | Date) => dayKey(d) === dayKey(new Date());
