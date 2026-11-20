'use client';

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

/** 같은 출처 API 호출 (httpOnly 세션 쿠키 사용) */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/${path.replace(/^\//, '')}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '네트워크 연결을 확인해 주세요.');
  }
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string; detail?: unknown } } | null;
  if (!res.ok || !json || json.error) {
    throw new ApiError(res.status, json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? '요청을 처리하지 못했어요.', json?.error?.detail);
  }
  return json.data as T;
}
