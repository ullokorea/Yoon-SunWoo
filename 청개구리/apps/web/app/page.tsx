import Link from 'next/link';
import { HomeFrogs } from '@/components/home-frogs';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#DDEBFF] via-mint to-white">
      <div className="mx-auto max-w-4xl px-5 py-12">
        <p className="text-sm font-bold text-brand-dark">날씨 기반 동네 매장 할인·예약</p>
        <h1 className="mt-2 text-4xl font-extrabold leading-tight sm:text-5xl">
          비가 오면,
          <br />
          <span className="text-brand-dark">혜택이 쏟아진다.</span>
        </h1>
        <p className="mt-4 max-w-xl text-muted">
          비 오는 날 비어 있는 좌석을 동네 손님과 연결해요. 점주는 할인율을 직접 정하고, 손님은 주변 매장을 발견해 예약하고, 방문은 QR로 확인해요.
        </p>
        <HomeFrogs />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Link href="/owner" className="rounded-2xl bg-brand p-5 text-white shadow-sm hover:bg-brand-dark">
            <p className="text-lg font-extrabold">점주 관리자</p>
            <p className="mt-1 text-sm opacity-90">할인 설정 · 예약 관리 · QR 방문 확인</p>
          </Link>
          <Link href="/admin" className="rounded-2xl bg-forest p-5 text-white shadow-sm hover:opacity-90">
            <p className="text-lg font-extrabold">플랫폼 관리자</p>
            <p className="mt-1 text-sm opacity-90">매장 승인 · 날씨 상태 · 운영 로그</p>
          </Link>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="text-lg font-extrabold">소비자 앱</p>
            <p className="mt-1 text-sm text-muted">
              Expo 앱 (apps/mobile). 개발 중에는 npm run dev:mobile 로 웹 미리보기를 열 수 있어요.
            </p>
          </div>
        </div>
        <p className="mt-10 text-xs text-subtle">청개구리(가칭) MVP · 개발 버전</p>
      </div>
    </main>
  );
}
