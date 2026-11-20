'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { DevBanner, Frog, Loading, useApi } from './ui';

export interface Me {
  id: string;
  email: string;
  nickname: string;
  roles: Array<'consumer' | 'owner' | 'admin'>;
}

/** 역할이 필요한 화면 래퍼. 서버 API 도 매 요청 권한을 다시 검증한다 (화면 가드는 편의용). */
export function RoleGate({ role, children }: { role: 'owner' | 'admin'; children: (me: Me) => ReactNode }) {
  const router = useRouter();
  const { data: me, loading } = useApi<Me | null>('me');
  useEffect(() => {
    if (!loading && (!me || !me.roles.includes(role))) router.replace(`/login?next=/${role}`);
  }, [loading, me, role, router]);
  if (loading || !me || !me.roles.includes(role)) return <Loading />;
  return <>{children(me)}</>;
}

export function Shell({ title, me, nav, children }: { title: string; me?: Me; nav?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <DevBanner />
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-1.5 font-extrabold text-brand-dark">
            <Frog pose="jumping" size={32} animated={false} />
            청개구리
          </Link>
          <span className="text-sm font-bold text-muted">{title}</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {me && <span className="hidden text-muted sm:inline">{me.nickname}님</span>}
            {me && (
              <button
                className="min-h-9 rounded-lg px-2 font-bold text-muted hover:bg-surface"
                onClick={async () => {
                  await api('auth/logout', { method: 'POST' }).catch(() => null);
                  router.replace('/login');
                }}
              >
                로그아웃
              </button>
            )}
          </div>
        </div>
        {nav && <div className="mx-auto max-w-6xl px-4 pb-2">{nav}</div>}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
