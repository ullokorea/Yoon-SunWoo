'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Button, DevBanner, Field, Frog, Input, Msg, useAction } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, msg, run } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api<{ user: { roles: string[] } }>('auth/login', { body: { email, password } }));
    if (!r) return;
    const next = new URLSearchParams(window.location.search).get('next');
    const roles = r.user.roles;
    if (next && /^\/(owner|admin)/.test(next)) router.replace(next);
    else router.replace(roles.includes('admin') ? '/admin' : roles.includes('owner') ? '/owner' : '/');
  }

  return (
    <div className="flex min-h-screen flex-col bg-mint">
      <DevBanner />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-10">
        <div className="flex flex-col items-center">
          <Frog pose="jumping" size={110} />
          <h1 className="mt-2 text-2xl font-extrabold">청개구리 로그인</h1>
          <p className="text-sm text-muted">점주 · 관리자 웹</p>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <Field label="이메일">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="비밀번호">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Msg msg={msg} />
          <Button className="w-full" size="lg" disabled={busy}>
            {busy ? '로그인 중…' : '로그인'}
          </Button>
          <p className="text-center text-sm text-muted">
            아직 점주 계정이 없나요?{' '}
            <Link href="/signup" className="font-bold text-brand-dark underline">
              점주 가입
            </Link>
          </p>
        </form>
        <details className="mt-4 rounded-xl bg-white/70 p-3 text-xs text-muted">
          <summary className="cursor-pointer font-bold">개발용 샘플 계정</summary>
          <p className="mt-2">비밀번호: cheong1234 (로컬 개발 DB 전용)</p>
          <ul className="mt-1 space-y-0.5">
            <li>점주 owner@cheong.dev · 카페 점주 owner2@cheong.dev</li>
            <li>관리자 admin@cheong.dev</li>
          </ul>
        </details>
      </main>
    </div>
  );
}
