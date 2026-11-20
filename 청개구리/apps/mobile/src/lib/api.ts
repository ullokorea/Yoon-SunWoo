// 청개구리 API 클라이언트 (Bearer 토큰)
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { storage } from './storage';

/**
 * API 주소
 * 1) EXPO_PUBLIC_API_URL 이 있으면 사용
 * 2) 개발 중에는 Metro 호스트 IP(같은 PC)의 3000 포트 (실기기·에뮬레이터 대응)
 */
export function apiBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web') return 'http://localhost:3000';
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'cg_token';
let token: string | null = null;
let loaded = false;

export async function loadToken() {
  if (!loaded) {
    token = await storage.get(TOKEN_KEY);
    loaded = true;
  }
  return token;
}
export async function setToken(t: string | null) {
  token = t;
  loaded = true;
  if (t) await storage.set(TOKEN_KEY, t);
  else await storage.remove(TOKEN_KEY);
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  await loadToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/v1/${path.replace(/^\//, '')}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new ApiError(0, 'NETWORK', aborted ? '응답이 늦어지고 있어요. 네트워크를 확인하고 다시 시도해 주세요.' : '서버에 연결할 수 없어요. 네트워크를 확인해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; detail?: unknown } } | null;
  if (!res.ok || !json || json.error) {
    if (res.status === 401 && token) await setToken(null);
    throw new ApiError(res.status, json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? '요청을 처리하지 못했어요.', json?.error?.detail);
  }
  return json.data as T;
}
