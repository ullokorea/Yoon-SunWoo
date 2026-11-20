'use client';

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { frogShapes, POSE_LABEL, type FrogPose } from '@cheong/design-tokens';
import { api, ApiError } from '@/lib/api-client';

// ---------------- 데이터 훅 ----------------

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** 버튼 클릭 → API 호출 → 결과 메시지 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (okText) setMsg({ ok: true, text: okText });
      return r;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, msg, run, setMsg };
}

// ---------------- 기본 컴포넌트 ----------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'sun';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark',
  secondary: 'bg-mint text-forest hover:bg-[#cdeedd]',
  ghost: 'bg-transparent text-forest hover:bg-surface border border-line',
  danger: 'bg-danger text-white hover:opacity-90',
  sun: 'bg-sun text-forest hover:brightness-95',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'min-h-9 px-3 text-sm' : size === 'lg' ? 'min-h-13 px-6 text-base' : 'min-h-11 px-4 text-sm';
  return (
    <button
      {...p}
      className={`${VARIANT[variant]} ${sz} inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    />
  );
}

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-white p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE = {
  green: 'bg-mint text-brand-dark',
  sun: 'bg-[#FFF3C4] text-sun-dark',
  gray: 'bg-surface text-muted',
  red: 'bg-danger-bg text-danger',
  blue: 'bg-[#EAF1FD] text-[#2F6FDE]',
  purple: 'bg-typhoon-bg text-typhoon',
  orange: 'bg-[#FFF0E0] text-mock',
};
export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full min-h-11 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand';
export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
}
export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={`${inputCls} ${p.className ?? ''}`} />;
}
export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={`${inputCls} py-2 ${p.className ?? ''}`} />;
}

export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? 'status' : 'alert'} className={`rounded-xl px-3 py-2 text-sm font-medium ${msg.ok ? 'bg-mint text-brand-dark' : 'bg-danger-bg text-danger'}`}>
      {msg.text}
    </p>
  );
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 justify-center text-muted text-sm" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: { message: string; status?: number } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl bg-danger-bg p-4 text-sm text-danger">
      <p className="font-bold">{error.message}</p>
      {onRetry && (
        <button className="mt-2 underline font-bold" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function Empty({ title, sub, pose = 'thinking' }: { title: string; sub?: string; pose?: FrogPose }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <Frog pose={pose} size={96} />
      <p className="mt-3 font-bold">{title}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<[T, string]>; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl bg-surface p-1 [scrollbar-width:none]">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={`min-h-10 shrink-0 rounded-xl px-3.5 text-sm font-bold transition ${value === k ? 'bg-white text-forest shadow-sm' : 'text-muted hover:text-forest'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'brand' | 'sun' | 'danger' }) {
  const color = tone === 'brand' ? 'text-brand-dark' : tone === 'sun' ? 'text-sun-dark' : tone === 'danger' ? 'text-danger' : 'text-forest';
  return (
    <div className="rounded-2xl bg-surface p-4">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

// ---------------- 개굴이 ----------------

export function Frog({ pose, size = 120, animated = true }: { pose: FrogPose; size?: number; animated?: boolean }) {
  const shapes = frogShapes(pose);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label={POSE_LABEL[pose]}
      className={animated && pose === 'jumping' ? 'frog-bounce' : undefined}
    >
      {shapes.map((s, i) => {
        const cls = animated && 'anim' in s && s.anim ? (s.anim === 'drop' ? 'frog-drop' : 'frog-sway') : undefined;
        const style = cls === 'frog-drop' ? { animationDelay: `${(i % 4) * 0.3}s` } : undefined;
        switch (s.t) {
          case 'ellipse':
            return <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} opacity={s.opacity} />;
          case 'circle':
            return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} opacity={s.opacity} />;
          case 'rect':
            return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill={s.fill} />;
          case 'path':
            return (
              <path
                key={i}
                d={s.d}
                fill={s.fill ?? 'none'}
                stroke={s.stroke}
                strokeWidth={s.sw}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={s.opacity}
                className={cls}
                style={style}
              />
            );
        }
      })}
    </svg>
  );
}

export const MODE_UI: Record<string, { label: string; tone: keyof typeof TONE; pose: FrogPose; emoji: string }> = {
  CLEAR: { label: '맑음', tone: 'green', pose: 'resting', emoji: '☀️' },
  RAIN_FORECAST: { label: '비 예보', tone: 'blue', pose: 'preparing', emoji: '🌦️' },
  RAINING: { label: '비 오는 중 · 할인 ON', tone: 'blue', pose: 'jumping', emoji: '🌧️' },
  TYPHOON_WATCH: { label: '태풍 접근', tone: 'purple', pose: 'sheltering', emoji: '🌀' },
  DANGER: { label: '기상 위험 · 예약 중단', tone: 'red', pose: 'sheltering', emoji: '⚠️' },
  RECOVERY: { label: '태풍 회복', tone: 'sun', pose: 'cheering', emoji: '🌈' },
  UNKNOWN: { label: '판정 불가 · 예약 제한', tone: 'gray', pose: 'thinking', emoji: '❔' },
};

export function ModeBadge({ mode, isMock }: { mode: string; isMock?: boolean }) {
  const m = MODE_UI[mode] ?? MODE_UI.UNKNOWN!;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={m.tone}>
        {m.emoji} {m.label}
      </Badge>
      {isMock && <Badge tone="orange">MOCK 날씨</Badge>}
    </span>
  );
}

export function DevBanner() {
  const { data } = useApi<{ env: string; weatherSource: string; pushMode: string; db: string }>('health');
  if (!data || (data.env === 'production' && data.weatherSource === 'kma' && data.pushMode === 'expo')) return null;
  return (
    <div className="bg-[#FFF0E0] px-4 py-1.5 text-center text-xs font-bold text-mock">
      개발 모드 · 날씨 {data.weatherSource === 'mock' ? 'MOCK (실제 기상청 데이터 아님)' : '기상청 연동'} · 푸시 {data.pushMode === 'mock' ? 'MOCK' : 'Expo'} · DB{' '}
      {data.db === 'pglite' ? '로컬 PGlite' : 'PostgreSQL'} · [샘플] 매장은 가상 데이터
    </div>
  );
}
