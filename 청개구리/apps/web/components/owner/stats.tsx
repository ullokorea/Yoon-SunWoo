'use client';

import { useState } from 'react';
import { won } from '@/lib/format';
import { Card, Empty, Loading, Select, Stat, useApi } from '../ui';

interface Stats {
  periodDays: number;
  byStatus: Array<{ status: string; label: string; n: number }>;
  confirmed: { label: string; visitedGuests: number; discountGiven: number };
  estimated: { label: string; revenueFromVisited: number; revenueUpcoming: number };
  byWeather: Array<{ mode: string; n: number; visited: number }>;
  byKind: Array<{ kind: string; n: number }>;
  popularMenus: Array<{ name: string; qty: number }>;
  daily: Array<{ day: string; n: number; visited: number }>;
}

const MODE: Record<string, string> = {
  RAINING: '비 오는 중', TYPHOON_WATCH: '태풍 접근', RECOVERY: '태풍 회복', CLEAR: '맑음', RAIN_FORECAST: '비 예보', DANGER: '위험', UNKNOWN: '판정 불가',
};
const KIND: Record<string, string> = { RAIN: '우천 할인', TYPHOON_PRE: '태풍 사전 특가', TYPHOON_RECOVERY: '태풍 회복 특가' };

function Bars({ rows }: { rows: Array<{ label: string; value: number; sub?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between">
            <span className="font-bold">{r.label}</span>
            <span className="text-muted">{r.value}{r.sub}</span>
          </div>
          <div className="mt-1 h-2.5 rounded-full bg-surface">
            <div className="h-2.5 rounded-full bg-brand" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OwnerStats({ storeId }: { storeId: string }) {
  const [days, setDays] = useState(30);
  const { data, loading } = useApi<Stats>(`owner/stores/${storeId}/stats?days=${days}`);
  if (loading || !data) return <Loading />;
  const total = data.byStatus.reduce((s, x) => s + x.n, 0);
  const visited = data.byStatus.find((s) => s.status === 'VISITED')?.n ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select className="!w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="예약 건수" value={`${total}건`} />
        <Stat label="방문 완료" value={`${visited}건`} tone="brand" sub={`방문 인원 ${data.confirmed.visitedGuests}명 (확정)`} />
        <Stat label="할인 제공액" value={won(data.confirmed.discountGiven)} sub="방문 확인 기준 (확정)" />
        <Stat label="추정 추가 매출" value={won(data.estimated.revenueFromVisited)} tone="sun" sub="예약 금액 기준 추정치 · 실제 결제 아님" />
      </div>
      <p className="rounded-xl bg-[#FFF3C4] p-3 text-xs text-sun-dark">
        <b>확정</b>은 QR·예약번호로 방문이 확인된 예약 기준이고, <b>추정</b>은 예약 시 선택한 메뉴 금액으로 계산한 값이에요. POS·결제 연동 전까지 실제 매출과 다를 수 있어요.
        예정된 예약 금액(추정): {won(data.estimated.revenueUpcoming)}
      </p>
      {total === 0 ? (
        <Card><Empty title="아직 통계가 없어요" sub="비 오는 날 예약이 들어오면 여기에 쌓여요." pose="resting" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="날씨별 예약">
            <Bars rows={data.byWeather.map((w) => ({ label: MODE[w.mode] ?? w.mode, value: w.n, sub: `건 · 방문 ${w.visited}` }))} />
          </Card>
          <Card title="할인 유형별">
            <Bars rows={data.byKind.map((k) => ({ label: KIND[k.kind] ?? k.kind, value: k.n, sub: '건' }))} />
          </Card>
          <Card title="인기 메뉴">
            <Bars rows={data.popularMenus.map((m) => ({ label: m.name, value: m.qty, sub: '개' }))} />
          </Card>
          <Card title="일자별 예약" className="md:col-span-3">
            <Bars rows={data.daily.map((d) => ({ label: d.day, value: d.n, sub: `건 · 방문 ${d.visited}` }))} />
          </Card>
          <Card title="상태별" className="md:col-span-3">
            <Bars rows={data.byStatus.map((s) => ({ label: s.label, value: s.n, sub: '건' }))} />
          </Card>
        </div>
      )}
    </div>
  );
}
