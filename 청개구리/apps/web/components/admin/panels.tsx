'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { dt, won } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, Input, Loading, ModeBadge, Msg, Select, Stat, Textarea, useAction, useApi } from '../ui';

const ask = (q: string) => window.prompt(q)?.trim() || null;

// ---------------- 개요 ----------------
interface Overview {
  weatherSource: string;
  pushMode: string;
  roles: Array<{ role: string; n: number }>;
  stores: Array<{ status: string; n: number }>;
  reservations30d: Array<{ status: string; label: string; n: number }>;
  pending: { stores: number; campaigns: number; reports: number };
  regions: Array<{ id: string; name: string; mode: string; isMock: boolean; lastFetchAt: string | null; lastFetchError: string | null; stale: boolean }>;
}

export function AdminOverview({ goto }: { goto: (t: string) => void }) {
  const { data, loading } = useApi<Overview>('admin/overview');
  if (loading || !data) return <Loading />;
  const n = (rows: Array<{ n: number }>) => rows.reduce((s, r) => s + r.n, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="소비자" value={data.roles.find((r) => r.role === 'consumer')?.n ?? 0} />
        <Stat label="점주" value={data.roles.find((r) => r.role === 'owner')?.n ?? 0} />
        <Stat label="승인된 매장" value={data.stores.find((s) => s.status === 'APPROVED')?.n ?? 0} tone="brand" />
        <Stat label="30일 예약" value={n(data.reservations30d)} />
      </div>
      <Card title="처리 대기">
        <div className="flex flex-wrap gap-2">
          <Button variant={data.pending.stores ? 'sun' : 'ghost'} onClick={() => goto('stores')}>매장 승인 {data.pending.stores}</Button>
          <Button variant={data.pending.campaigns ? 'sun' : 'ghost'} onClick={() => goto('campaigns')}>할인 검수 {data.pending.campaigns}</Button>
          <Button variant={data.pending.reports ? 'sun' : 'ghost'} onClick={() => goto('reports')}>신고·문의 {data.pending.reports}</Button>
        </div>
      </Card>
      <Card title="외부 연동 상태">
        <ul className="space-y-1 text-sm">
          <li>기상청 날씨: {data.weatherSource === 'kma' ? <Badge tone="green">기상청 API 연동</Badge> : <Badge tone="orange">MOCK — KMA_SERVICE_KEY 미설정</Badge>}</li>
          <li>푸시 알림: {data.pushMode === 'expo' ? <Badge tone="green">Expo Push</Badge> : <Badge tone="orange">MOCK — 실제 발송 안 함 (인앱 알림만)</Badge>}</li>
          <li>지도: <Badge tone="orange">미연동 — 거리 계산만 사용</Badge></li>
          <li>결제: <Badge>MVP 범위 아님 — 현장 결제</Badge></li>
        </ul>
      </Card>
      <Card title="지역별 할인 활성화 상태">
        <ul className="divide-y divide-line">
          {data.regions.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-bold">{r.name}</span>
              <ModeBadge mode={r.mode} isMock={r.isMock} />
              {r.stale && <Badge tone="red">데이터 오래됨</Badge>}
              <span className="ml-auto text-xs text-muted">{r.lastFetchAt ? `갱신 ${dt(r.lastFetchAt)}` : '미갱신'}</span>
              {r.lastFetchError && <p className="w-full text-xs text-danger">오류: {r.lastFetchError}</p>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------- 매장 승인 ----------------
interface AdminStore {
  id: string;
  name: string;
  category: string;
  address: string;
  regionName: string;
  status: string;
  statusNote: string | null;
  isSample: boolean;
  ownerEmail: string | null;
  businessNumber: string | null;
  representativeName: string | null;
  createdAt: string;
}
const STORE_STATUS: Record<string, [string, 'green' | 'sun' | 'red']> = {
  APPROVED: ['승인', 'green'],
  PENDING: ['대기', 'sun'],
  REJECTED: ['반려', 'red'],
  SUSPENDED: ['정지', 'red'],
};

export function AdminStores() {
  const [status, setStatus] = useState('PENDING');
  const { data, loading, reload } = useApi<AdminStore[]>(`admin/stores${status ? `?status=${status}` : ''}`);
  const { busy, msg, run } = useAction();
  const review = (id: string, decision: string, needNote: boolean) => {
    const note = needNote ? ask('사유를 입력해 주세요 (점주에게 전달됩니다).') : undefined;
    if (needNote && !note) return;
    void run(async () => { await api(`admin/stores/${id}/review`, { body: { decision, note } }); reload(); }, '처리했어요.');
  };
  return (
    <Card title="매장 승인·관리" action={
      <Select className="!w-32" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="PENDING">대기</option><option value="APPROVED">승인</option><option value="SUSPENDED">정지</option><option value="REJECTED">반려</option><option value="">전체</option>
      </Select>}>
      <Msg msg={msg} />
      {loading ? <Loading /> : !data?.length ? <Empty title="해당 매장이 없어요" pose="resting" /> : (
        <ul className="divide-y divide-line">
          {data.map((s) => (
            <li key={s.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold">{s.name} <Badge tone={STORE_STATUS[s.status]?.[1]}>{STORE_STATUS[s.status]?.[0]}</Badge> {s.isSample && <Badge tone="orange">샘플</Badge>}</p>
                <p className="text-xs text-muted">{s.category} · {s.regionName} · {s.address}</p>
                <p className="text-xs text-muted">점주 {s.ownerEmail ?? '-'} · 사업자 {s.businessNumber ?? '-'} · 대표 {s.representativeName ?? '-'}</p>
                {s.statusNote && <p className="text-xs text-danger">메모: {s.statusNote}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.status === 'PENDING' && <><Button size="sm" disabled={busy} onClick={() => review(s.id, 'APPROVE', false)}>승인</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => review(s.id, 'REJECT', true)}>반려</Button></>}
                {s.status === 'APPROVED' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => review(s.id, 'SUSPEND', true)}>비활성화</Button>}
                {s.status === 'SUSPENDED' && <Button size="sm" disabled={busy} onClick={() => review(s.id, 'RESTORE', false)}>복구</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">사업자등록번호는 형식(체크섬)만 자동 검증돼요. 승인 전 국세청 사업자 상태 조회로 진위를 확인해 주세요 (API 미연동).</p>
    </Card>
  );
}

// ---------------- 할인 검수 ----------------
interface AdminCampaign {
  id: string; storeName: string; kind: string; kindLabel: string; title: string; rate: number; status: string; validFrom: string; validUntil: string; reviewNote: string | null; dailyLimit: number | null;
}
export function AdminCampaigns() {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const { data, loading, reload } = useApi<AdminCampaign[]>(`admin/campaigns${status ? `?status=${status}` : ''}`);
  const { busy, msg, run } = useAction();
  const review = (id: string, decision: string) => {
    const note = decision === 'APPROVE' ? undefined : ask('사유를 입력해 주세요.');
    if (decision !== 'APPROVE' && !note) return;
    void run(async () => { await api(`admin/campaigns/${id}/review`, { body: { decision, note } }); reload(); }, '처리했어요.');
  };
  return (
    <Card title="할인·태풍 특가 검수" action={
      <Select className="!w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="PENDING_REVIEW">검수 대기</option><option value="APPROVED">승인</option><option value="SUSPENDED">중지</option><option value="REJECTED">반려</option><option value="">전체</option>
      </Select>}>
      <p className="mb-2 text-xs text-muted">검수 기준: 실제 제공 가능한 할인율인지, 태풍 특가가 위험 시간대 방문을 유도하지 않는지(시스템이 시간대를 자동 제한), 과장 문구가 없는지.</p>
      <Msg msg={msg} />
      {loading ? <Loading /> : !data?.length ? <Empty title="검수할 할인이 없어요" pose="resting" /> : (
        <ul className="divide-y divide-line">
          {data.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
              <div className="flex-1 text-sm">
                <p className="font-bold"><span className="text-lg">{c.rate}%</span> {c.title} <Badge tone={c.kind === 'RAIN' ? 'blue' : 'purple'}>{c.kindLabel}</Badge></p>
                <p className="text-xs text-muted">{c.storeName} · {dt(c.validFrom)} ~ {dt(c.validUntil)}{c.dailyLimit ? ` · 하루 ${c.dailyLimit}건` : ''}</p>
                {c.reviewNote && <p className="text-xs text-danger">메모: {c.reviewNote}</p>}
              </div>
              <div className="flex gap-1.5">
                {c.status !== 'APPROVED' && <Button size="sm" disabled={busy} onClick={() => review(c.id, 'APPROVE')}>승인</Button>}
                {c.status === 'PENDING_REVIEW' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => review(c.id, 'REJECT')}>반려</Button>}
                {c.status === 'APPROVED' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => review(c.id, 'SUSPEND')}>운영 중지</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------- 날씨·지역 ----------------
interface Region { id: string; name: string; mode: string; rain: string; safety: string; isMock: boolean; mockScenario: string | null; lastSnapshotAt: string | null; lastFetchError: string | null; nx: number; ny: number; typhoon: { name: string } | null }
interface Health { weatherSource: string; mockScenarios: Record<string, string> | null }

function RegionDetail({ id }: { id: string }) {
  const { data } = useApi<{ history: Array<{ prevRain: string; nextRain: string; prevSafety: string; nextSafety: string; reason: string; source: string | null; createdAt: string }>; alerts: Array<{ title: string; level: string }> }>(`admin/regions/${id}`);
  if (!data) return null;
  return (
    <div className="mt-2 rounded-xl bg-surface p-3 text-xs">
      <p className="font-bold">발효 중 특보: {data.alerts.length ? data.alerts.map((a) => a.title).join(', ') : '없음'}</p>
      <p className="mt-2 font-bold">상태 변경 이력</p>
      <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
        {data.history.map((h, i) => (
          <li key={i}>
            <span className="text-muted">{dt(h.createdAt)}</span> {h.prevRain}/{h.prevSafety} → <b>{h.nextRain}/{h.nextSafety}</b> · {h.reason} {h.source && <Badge tone={h.source === 'MOCK' ? 'orange' : 'gray'}>{h.source}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminWeather() {
  const { data: regions, loading, reload } = useApi<Region[]>('regions');
  const { data: health } = useApi<Health>('health');
  const { busy, msg, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [ty, setTy] = useState({ name: '', impact: '', clear: '' });
  if (loading || !regions) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title="지역별 날씨 판정" action={<Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api('admin/weather/refresh', { method: 'POST' }); reload(); }, '전체 지역을 갱신했어요.')}>지금 갱신</Button>}>
        {health?.weatherSource === 'mock' && <p className="mb-2 rounded-xl bg-[#FFF0E0] p-3 text-xs font-bold text-mock">MOCK 모드: 아래 시나리오는 개발·시연용 가상 날씨예요. 실제 기상청 데이터가 아니에요.</p>}
        <Msg msg={msg} />
        <ul className="divide-y divide-line">
          {regions.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className="font-bold underline-offset-2 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{r.name}</button>
                <span className="text-xs text-muted">격자 {r.nx},{r.ny}</span>
                <ModeBadge mode={r.mode} isMock={r.isMock} />
                {r.typhoon && <Badge tone="purple">{r.typhoon.name}</Badge>}
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {health?.mockScenarios && (
                    <Select className="!min-h-9 !w-48" value={r.mockScenario ?? 'clear'} disabled={busy}
                      onChange={(e) => run(async () => { await api(`admin/regions/${r.id}/mock`, { body: { scenario: e.target.value } }); reload(); }, `MOCK 시나리오: ${health.mockScenarios![e.target.value]}`)}>
                      {Object.entries(health.mockScenarios).map(([k, v]) => <option key={k} value={k}>[MOCK] {v}</option>)}
                    </Select>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const reason = ask('현장 위험 근거 (예: 침수 신고)'); if (reason) void run(async () => { await api(`admin/regions/${r.id}/safety`, { body: { target: 'DANGER', reason } }); reload(); }, '위험 지역으로 지정했어요.'); }}>위험 지정</Button>
                  {r.mode === 'DANGER' && (
                    <Button size="sm" variant="sun" disabled={busy} onClick={() => { const reason = ask('안전 확인 근거 (예: 구청 피해 없음 확인)'); if (reason) void run(async () => { await api(`admin/regions/${r.id}/safety`, { body: { target: 'RECOVERY', reason } }); reload(); }, '회복 단계로 전환했어요.'); }}>안전 확인 → 회복</Button>
                  )}
                </div>
              </div>
              {r.lastFetchError && <p className="mt-1 text-xs text-danger">조회 오류: {r.lastFetchError}</p>}
              {open === r.id && <RegionDetail id={r.id} />}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">위험 진입은 즉시, 해제는 특보 해제 후 6시간 유예(또는 운영자 안전 확인) 뒤 회복 단계로 넘어가요. 판정이 불확실하면 신규 예약을 막아요.</p>
      </Card>
      <Card title="태풍 영향 예상 시각 입력">
        <p className="mb-2 text-xs text-muted">기상청 태풍 정보 발표를 확인해 입력해요. 태풍 사전 특가는 &quot;영향 시작 6시간 전까지 끝나는 시간대&quot;만, 회복 사전 예약은 &quot;종료 24시간 이후&quot;만 열려요.</p>
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('admin/regions/typhoon', { body: { regionIds: regions.map((r) => r.id), outlook: { name: ty.name, expectedImpactAt: new Date(ty.impact).toISOString(), expectedClearAt: new Date(ty.clear).toISOString() } } }); reload(); }, '전체 지역에 태풍 정보를 입력했어요.'); }}>
          <Field label="태풍 이름"><Input required value={ty.name} onChange={(e) => setTy({ ...ty, name: e.target.value })} /></Field>
          <Field label="영향 시작 예상"><Input required type="datetime-local" value={ty.impact} onChange={(e) => setTy({ ...ty, impact: e.target.value })} /></Field>
          <Field label="영향 종료 예상"><Input required type="datetime-local" value={ty.clear} onChange={(e) => setTy({ ...ty, clear: e.target.value })} /></Field>
          <div className="flex items-end gap-2">
            <Button disabled={busy}>전체 지역 적용</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => run(async () => { await api('admin/regions/typhoon', { body: { regionIds: regions.map((r) => r.id), outlook: null } }); reload(); }, '태풍 정보를 지웠어요.')}>해제</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ---------------- 예약 ----------------
interface AdminResv { id: string; code: string; statusLabel: string; status: string; storeName: string; customer: string; slotStartAt: string; partySize: number; discountRate: number; totalAmount: number; weatherMode: string }
export function AdminReservations() {
  const [status, setStatus] = useState('');
  const { data, loading } = useApi<AdminResv[]>(`admin/reservations${status ? `?status=${status}` : ''}`);
  return (
    <Card title="예약 현황 (최근 200건)" action={
      <Select className="!w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">전체</option><option value="CONFIRMED">확정</option><option value="PENDING">대기</option><option value="VISITED">방문</option><option value="NO_SHOW">노쇼</option><option value="CANCELLED_SAFETY">안전 취소</option>
      </Select>}>
      {loading ? <Loading /> : !data?.length ? <Empty title="예약이 없어요" pose="resting" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-2">예약번호</th><th>매장</th><th>고객</th><th>방문</th><th>인원</th><th>할인</th><th>금액</th><th>상태</th><th>예약 시 날씨</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((r) => (
                <tr key={r.id}><td className="py-2 font-mono text-xs">{r.code}</td><td>{r.storeName}</td><td>{r.customer}</td><td>{dt(r.slotStartAt)}</td><td>{r.partySize}</td><td>{r.discountRate}%</td><td>{won(r.totalAmount)}</td><td><Badge>{r.statusLabel}</Badge></td><td className="text-xs">{r.weatherMode}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">고객 이름은 마스킹되어 표시돼요.</p>
    </Card>
  );
}

// ---------------- 사용자 ----------------
interface AdminUser { id: string; email: string; status: string; nickname: string; roles: string[]; reservations: number; createdAt: string }
export function AdminUsers() {
  const { data, loading, reload } = useApi<AdminUser[]>('admin/users');
  const { busy, msg, run } = useAction();
  return (
    <Card title="사용자·점주 관리">
      <Msg msg={msg} />
      {loading ? <Loading /> : (
        <ul className="divide-y divide-line">
          {data?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-bold">{u.nickname}</span>
              <span className="text-muted">{u.email}</span>
              {u.roles.map((r) => <Badge key={r} tone={r === 'admin' ? 'purple' : r === 'owner' ? 'green' : 'gray'}>{r}</Badge>)}
              {u.status !== 'ACTIVE' && <Badge tone="red">{u.status}</Badge>}
              <span className="text-xs text-muted">예약 {u.reservations}</span>
              <span className="ml-auto">
                {u.status === 'ACTIVE' && !u.roles.includes('admin') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const reason = ask('이용 정지 사유'); if (reason) void run(async () => { await api(`admin/users/${u.id}/status`, { body: { status: 'SUSPENDED', reason } }); reload(); }, '이용을 정지했어요.'); }}>이용 정지</Button>}
                {u.status === 'SUSPENDED' && <Button size="sm" disabled={busy} onClick={() => { const reason = ask('정지 해제 사유'); if (reason) void run(async () => { await api(`admin/users/${u.id}/status`, { body: { status: 'ACTIVE', reason } }); reload(); }, '정지를 해제했어요.'); }}>정지 해제</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------- 이상 거래 ----------------
export function AdminAnomalies() {
  const { data, loading } = useApi<Array<{ rule: string; items: Array<Record<string, string | number>> }>>('admin/anomalies');
  if (loading || !data) return <Loading />;
  return (
    <Card title="이상 거래 탐지 (규칙 기반)">
      <p className="mb-2 text-xs text-muted">자동 제재하지 않아요. 운영자가 확인 후 조치합니다.</p>
      <ul className="space-y-3">
        {data.map((g) => (
          <li key={g.rule}>
            <p className="text-sm font-bold">{g.rule} <Badge tone={g.items.length ? 'red' : 'green'}>{g.items.length}건</Badge></p>
            {g.items.map((it, i) => <p key={i} className="text-xs text-muted">{String(it.email ?? it.store)} · {it.count}회</p>)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------- 신고·문의 ----------------
interface Report { id: string; type: string; content: string; status: string; adminNote: string | null; createdAt: string; storeName: string | null; reservationCode: string | null }
export function AdminReports() {
  const { data, loading, reload } = useApi<Report[]>('admin/reports');
  const { busy, msg, run } = useAction();
  const [note, setNote] = useState<Record<string, string>>({});
  return (
    <Card title="신고·분쟁·고객 문의">
      <Msg msg={msg} />
      {loading ? <Loading /> : !data?.length ? <Empty title="접수된 문의가 없어요" pose="resting" /> : (
        <ul className="divide-y divide-line">
          {data.map((r) => (
            <li key={r.id} className="py-3 text-sm">
              <p className="font-bold"><Badge tone={r.status === 'RESOLVED' ? 'green' : 'sun'}>{r.status}</Badge> {r.type} {r.storeName && `· ${r.storeName}`} {r.reservationCode && `· ${r.reservationCode}`}</p>
              <p className="mt-1 whitespace-pre-wrap">{r.content}</p>
              <p className="text-xs text-muted">{dt(r.createdAt)}</p>
              <div className="mt-2 flex gap-2">
                <Textarea rows={1} placeholder="처리 메모" value={note[r.id] ?? r.adminNote ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`admin/reports/${r.id}`, { body: { status: 'IN_PROGRESS', note: note[r.id] } }); reload(); })}>처리 중</Button>
                <Button size="sm" disabled={busy} onClick={() => run(async () => { await api(`admin/reports/${r.id}`, { body: { status: 'RESOLVED', note: note[r.id] } }); reload(); })}>완료</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------- 운영 로그 ----------------
export function AdminLogs() {
  const { data, loading } = useApi<Array<{ action: string; actorRole: string; targetType: string; targetId: string | null; detail: unknown; createdAt: string; email: string | null }>>('admin/audit-logs?limit=200');
  return (
    <Card title="운영 로그 (감사 로그)">
      {loading ? <Loading /> : (
        <ul className="divide-y divide-line text-xs">
          {data?.map((l, i) => (
            <li key={i} className="flex flex-wrap gap-2 py-2">
              <span className="text-muted">{dt(l.createdAt)}</span>
              <Badge tone={l.actorRole === 'admin' ? 'purple' : l.actorRole === 'owner' ? 'green' : 'gray'}>{l.actorRole}</Badge>
              <span className="font-bold">{l.action}</span>
              <span className="text-muted">{l.targetType}:{l.targetId?.slice(0, 8)}</span>
              <span className="text-muted">{l.email}</span>
              {l.detail ? <code className="w-full truncate text-subtle">{JSON.stringify(l.detail)}</code> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
