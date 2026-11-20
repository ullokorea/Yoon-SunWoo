'use client';

import { api } from '@/lib/api-client';
import { won } from '@/lib/format';
import { Badge, Button, Card, Frog, Loading, MODE_UI, Msg, Stat, useAction, useApi } from '../ui';

interface Dash {
  today: { total: number; pending: number; confirmed: number; visited: number; discount: number };
  region: { mode: string; name: string; isMock: boolean; copy: { headline: string; sub: string }; lastSnapshotAt: string | null; typhoon: { name: string; expectedImpactAt: string; expectedClearAt: string } | null };
  campaigns: Array<{ kind: string; rate: number; title: string; paused: boolean; status: string; auto_activate: boolean }>;
}

const KIND: Record<string, string> = { RAIN: '우천', TYPHOON_PRE: '태풍 사전', TYPHOON_RECOVERY: '태풍 회복' };
const WAIT: Record<string, string> = { RAIN: '비 오면 열림', TYPHOON_PRE: '태풍 접근 시 열림', TYPHOON_RECOVERY: '태풍 접근·회복 시 열림' };
function isLive(kind: string, mode: string) {
  if (kind === 'RAIN') return mode === 'RAINING';
  if (kind === 'TYPHOON_PRE') return mode === 'TYPHOON_WATCH';
  return mode === 'RECOVERY' || mode === 'TYPHOON_WATCH';
}
const OWNER_COPY: Record<string, string> = {
  CLEAR: '맑은 날이에요. 우천 할인은 비가 오면 자동으로 열려요.',
  RAIN_FORECAST: '비 예보가 있어요. 할인율과 예약 가능 수량을 미리 점검해 주세요.',
  RAINING: '비가 와요! 우천 할인 예약이 열려 있어요.',
  TYPHOON_WATCH: '태풍 접근 예보. 태풍 전 안전한 시간대 / 태풍 이후 방문 특가를 준비할 수 있어요.',
  DANGER: '기상특보 발효 중 — 안전을 위해 신규 방문 예약이 자동 중단됐어요. 기존 예약 고객에게는 무료 취소 안내가 발송돼요.',
  RECOVERY: '특보가 해제됐어요. 매장이 안전하게 영업 중이면 "영업 재개 확인"을 눌러 회복 특가를 열어 주세요.',
  UNKNOWN: '기상 정보를 확인할 수 없어 안전을 위해 신규 예약이 잠시 제한돼요.',
};

export function OwnerDashboard({
  storeId,
  store,
  onChanged,
  goto,
}: {
  storeId: string;
  store: { operationPaused: boolean; reopenConfirmedAt: string | null };
  onChanged: () => void;
  goto: (t: 'resv' | 'verify' | 'discount') => void;
}) {
  const { data, loading, reload } = useApi<Dash>(`owner/stores/${storeId}/dashboard`);
  const { busy, msg, run } = useAction();
  if (loading || !data) return <Loading />;
  const m = MODE_UI[data.region.mode] ?? MODE_UI.UNKNOWN!;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-4">
          <Frog pose={m.pose} size={92} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-muted">
              {data.region.name} · {data.region.isMock ? 'MOCK 날씨 (실제 아님)' : '기상청'}
            </p>
            <p className="mt-0.5 text-lg font-extrabold">
              {m.emoji} {m.label}
            </p>
            <p className="mt-1 text-sm text-muted">{OWNER_COPY[data.region.mode]}</p>
            {data.region.typhoon && (
              <p className="mt-1 text-xs text-typhoon">
                {data.region.typhoon.name} · 영향 예상 {new Date(data.region.typhoon.expectedImpactAt).toLocaleString('ko-KR')} ~{' '}
                {new Date(data.region.typhoon.expectedClearAt).toLocaleString('ko-KR')}
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="오늘 예약" value={`${data.today.total}건`} />
        <Stat label="승인 대기" value={`${data.today.pending}건`} tone={data.today.pending ? 'sun' : undefined} sub={data.today.pending ? '30분 내 처리 필요' : undefined} />
        <Stat label="방문 예정" value={`${data.today.confirmed}건`} tone="brand" />
        <Stat label="오늘 방문 완료" value={`${data.today.visited}건`} sub={`할인 제공 ${won(data.today.discount)}`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="할인 활성화 상태" action={<Button size="sm" variant="ghost" onClick={() => goto('discount')}>설정</Button>}>
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-muted">등록된 할인이 없어요. 우천 할인부터 등록해 보세요.</p>
          ) : (
            <ul className="space-y-2">
              {data.campaigns.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <Badge tone={c.kind === 'RAIN' ? 'blue' : 'purple'}>{KIND[c.kind]}</Badge>
                  <span className="font-bold">{c.rate}%</span>
                  <span className="truncate text-muted">{c.title}</span>
                  <span className="ml-auto">
                    {c.status !== 'APPROVED' ? (
                      <Badge tone="sun">{c.status === 'PENDING_REVIEW' ? '검수 대기' : c.status}</Badge>
                    ) : c.paused ? (
                      <Badge>일시정지</Badge>
                    ) : c.kind === 'RAIN' && !c.auto_activate ? (
                      <Badge>자동 활성화 꺼짐</Badge>
                    ) : isLive(c.kind, data.region.mode) ? (
                      <Badge tone="green">지금 적용 중</Badge>
                    ) : (
                      <Badge>대기 · {WAIT[c.kind]}</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="매장 운영">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{store.operationPaused ? '영업 중단 중' : '영업 중'}</p>
                <p className="text-xs text-muted">영업을 중단하면 신규 예약이 즉시 막혀요. 기존 예약은 예약 관리에서 처리해 주세요.</p>
              </div>
              <Button
                variant={store.operationPaused ? 'primary' : 'ghost'}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`owner/stores/${storeId}/pause`, { body: { paused: !store.operationPaused } });
                    onChanged();
                    reload();
                  }, store.operationPaused ? '영업을 재개했어요.' : '영업을 중단했어요.')
                }
              >
                {store.operationPaused ? '영업 재개' : '영업 중단'}
              </Button>
            </div>
            {data.region.mode === 'RECOVERY' && (
              <div className="rounded-xl bg-[#FFF6D8] p-3">
                <p className="text-sm font-bold">태풍 이후 영업 재개 확인</p>
                <p className="text-xs text-muted">
                  {store.reopenConfirmedAt ? `확인 완료 (${new Date(store.reopenConfirmedAt).toLocaleString('ko-KR')})` : '매장 안전과 영업 가능 여부를 확인한 뒤 눌러 주세요. 회복 특가가 열리고 단골 고객에게 알림이 가요.'}
                </p>
                <Button
                  className="mt-2"
                  variant="sun"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`owner/stores/${storeId}/reopen`, { method: 'POST' });
                      onChanged();
                    }, '영업 재개를 확인했어요. 회복 특가가 열렸어요.')
                  }
                >
                  안전 확인 · 영업 재개
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => goto('resv')}>예약 보기</Button>
              <Button variant="secondary" onClick={() => goto('verify')}>QR 방문 확인</Button>
            </div>
            <Msg msg={msg} />
          </div>
        </Card>
      </div>
    </div>
  );
}
