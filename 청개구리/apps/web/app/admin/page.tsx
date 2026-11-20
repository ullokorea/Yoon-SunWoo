'use client';

import { useEffect, useState } from 'react';
import { RoleGate, Shell } from '@/components/shell';
import { Tabs } from '@/components/ui';
import {
  AdminAnomalies,
  AdminCampaigns,
  AdminLogs,
  AdminOverview,
  AdminReports,
  AdminReservations,
  AdminStores,
  AdminUsers,
  AdminWeather,
} from '@/components/admin/panels';

const TABS = [
  ['overview', '개요'],
  ['stores', '매장 승인'],
  ['campaigns', '할인 검수'],
  ['weather', '날씨·지역'],
  ['reservations', '예약'],
  ['users', '사용자'],
  ['anomalies', '이상 거래'],
  ['reports', '신고·문의'],
  ['logs', '운영 로그'],
] as Array<[string, string]>;

function AdminConsole() {
  const [tab, setTab] = useState('overview');
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (TABS.some(([k]) => k === h)) setTab(h);
  }, []);
  const change = (t: string) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  return (
    <div className="space-y-4">
      <Tabs tabs={TABS} value={tab} onChange={change} />
      {tab === 'overview' && <AdminOverview goto={change} />}
      {tab === 'stores' && <AdminStores />}
      {tab === 'campaigns' && <AdminCampaigns />}
      {tab === 'weather' && <AdminWeather />}
      {tab === 'reservations' && <AdminReservations />}
      {tab === 'users' && <AdminUsers />}
      {tab === 'anomalies' && <AdminAnomalies />}
      {tab === 'reports' && <AdminReports />}
      {tab === 'logs' && <AdminLogs />}
    </div>
  );
}

export default function AdminPage() {
  return (
    <RoleGate role="admin">
      {(me) => (
        <Shell title="플랫폼 관리자" me={me}>
          <AdminConsole />
        </Shell>
      )}
    </RoleGate>
  );
}
