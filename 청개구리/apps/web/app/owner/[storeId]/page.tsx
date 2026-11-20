'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RoleGate, Shell } from '@/components/shell';
import { Badge, ErrorBox, Loading, ModeBadge, Tabs, useApi } from '@/components/ui';
import { OwnerDashboard } from '@/components/owner/dashboard';
import { OwnerReservations } from '@/components/owner/reservations';
import { OwnerVerify } from '@/components/owner/verify';
import { OwnerDiscounts } from '@/components/owner/discounts';
import { OwnerStoreInfo } from '@/components/owner/store-info';
import { OwnerSlots } from '@/components/owner/slots';
import { OwnerStats } from '@/components/owner/stats';

export interface OwnerStoreDetail {
  id: string;
  name: string;
  status: string;
  statusNote: string | null;
  operationPaused: boolean;
  reopenConfirmedAt: string | null;
  isSample: boolean;
  region: { mode: string; name: string; isMock: boolean; copy: { headline: string; sub: string } };
  menus: Array<{ id: string; name: string; price: number; isSet: boolean; isAvailable: boolean; description: string; sortOrder: number }>;
  [k: string]: unknown;
}

type Tab = 'dash' | 'resv' | 'verify' | 'discount' | 'store' | 'slots' | 'stats';
const TABS: Array<[Tab, string]> = [
  ['dash', '대시보드'],
  ['resv', '예약 관리'],
  ['verify', 'QR 방문 확인'],
  ['discount', '할인 관리'],
  ['slots', '예약 시간'],
  ['store', '매장·메뉴'],
  ['stats', '통계'],
];

function Console({ storeId }: { storeId: string }) {
  const [tab, setTab] = useState<Tab>('dash');
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.some(([k]) => k === h)) setTab(h);
  }, []);
  const { data: store, error, reload } = useApi<OwnerStoreDetail>(`owner/stores/${storeId}`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!store) return <Loading />;
  const change = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/owner" className="text-sm font-bold text-muted hover:text-forest">← 내 매장</Link>
        <h1 className="text-xl font-extrabold">{store.name}</h1>
        {store.status !== 'APPROVED' && <Badge tone={store.status === 'PENDING' ? 'sun' : 'red'}>{store.status === 'PENDING' ? '승인 대기' : store.status}</Badge>}
        {store.operationPaused && <Badge tone="red">영업 중단 중</Badge>}
        <ModeBadge mode={store.region.mode} isMock={store.region.isMock} />
      </div>
      {store.status === 'PENDING' && (
        <p className="rounded-xl bg-[#FFF3C4] p-3 text-sm text-sun-dark">운영팀이 사업자 정보를 확인 중이에요. 승인 전에도 메뉴·할인·예약 시간을 미리 준비할 수 있어요.</p>
      )}
      <Tabs tabs={TABS} value={tab} onChange={change} />
      {tab === 'dash' && <OwnerDashboard storeId={storeId} store={store} onChanged={reload} goto={change} />}
      {tab === 'resv' && <OwnerReservations storeId={storeId} />}
      {tab === 'verify' && <OwnerVerify storeId={storeId} />}
      {tab === 'discount' && <OwnerDiscounts storeId={storeId} menus={store.menus} />}
      {tab === 'slots' && <OwnerSlots storeId={storeId} />}
      {tab === 'store' && <OwnerStoreInfo storeId={storeId} store={store} onChanged={reload} />}
      {tab === 'stats' && <OwnerStats storeId={storeId} />}
    </div>
  );
}

export default function OwnerStorePage() {
  const { storeId } = useParams<{ storeId: string }>();
  return (
    <RoleGate role="owner">
      {(me) => (
        <Shell title="점주 관리자" me={me}>
          <Console storeId={storeId} />
        </Shell>
      )}
    </RoleGate>
  );
}
