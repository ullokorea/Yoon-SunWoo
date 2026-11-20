'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Button, DevBanner, Field, Frog, Input, Msg, useAction } from '@/components/ui';

export default function OwnerSignup() {
  const router = useRouter();
  const [f, setF] = useState({ email: '', password: '', nickname: '', agreeTerms: false, agreePrivacy: false });
  const { busy, msg, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="flex min-h-screen flex-col bg-mint">
      <DevBanner />
      <main className="mx-auto w-full max-w-sm flex-1 px-5 py-10">
        <div className="flex flex-col items-center">
          <Frog pose="cheering" size={100} />
          <h1 className="mt-2 text-2xl font-extrabold">점주 가입</h1>
          <p className="text-center text-sm text-muted">가입 후 매장을 등록하면 운영팀 승인 뒤 노출돼요.</p>
        </div>
        <form
          className="mt-6 space-y-3 rounded-2xl bg-white p-5 shadow-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api('auth/signup', { body: { ...f, role: 'owner' } }));
            if (r) router.replace('/owner/new');
          }}
        >
          <Field label="이메일">
            <Input type="email" required value={f.email} onChange={set('email')} />
          </Field>
          <Field label="비밀번호" hint="8자 이상, 영문과 숫자 포함">
            <Input type="password" required value={f.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
          <Field label="담당자 이름 (닉네임)">
            <Input required maxLength={20} value={f.nickname} onChange={set('nickname')} />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[#45B96B]" checked={f.agreeTerms} onChange={set('agreeTerms')} />
            (필수) 점주 이용약관 동의 <span className="text-xs text-subtle">— 약관 초안, 법률 검토 전</span>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[#45B96B]" checked={f.agreePrivacy} onChange={set('agreePrivacy')} />
            (필수) 개인정보 수집·이용 동의
          </label>
          <Msg msg={msg} />
          <Button className="w-full" size="lg" disabled={busy}>
            가입하고 매장 등록하기
          </Button>
        </form>
      </main>
    </div>
  );
}
