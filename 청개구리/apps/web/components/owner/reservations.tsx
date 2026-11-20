'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { addDays, hm, md, todayKst, won } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Msg, Select, useAction, useApi } from '../ui';

interface Row {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  slotStartAt: string;
  partySize: number;
  customerName: string;
  customerPhone: string | null;
  items: string;
  discountRate: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  campaignKind: string;
}

const TONE: Record<string, 'green' | 'sun' | 'gray' | 'red' | 'blue'> = {
  PENDING: 'sun',
  CONFIRMED: 'green',
  VISITED: 'blue',
  NO_SHOW: 'red',
};

export function OwnerReservations({ storeId }: { storeId: string }) {
  const [date, setDate] = useState(todayKst());
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi<Row[]>(`owner/stores/${storeId}/reservations?date=${date}${status ? `&status=${status}` : ''}`);
  const { busy, msg, run } = useAction();

  async function act(r: Row, action: string) {
    let reason: string | undefined;
    if (action === 'REJECT' || action === 'CANCEL_BY_STORE') {
      reason = window.prompt('고객에게 안내할 사유를 입력해 주세요.') ?? undefined;
      if (!reason) return;
    }
    if (action === 'NO_SHOW' && !window.confirm(`${r.code} 예약을 노쇼로 처리할까요?`)) return;
    await run(async () => {
      await api(`owner/stores/${storeId}/reservations/${r.id}/action`, { body: { action, reason } });
      reload();
    }, '처리했어요.');
  }

  return (
    <Card title="예약 관리">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, -1))} aria-label="이전 날">‹</Button>
        <Input type="date" className="!w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button size="sm" variant="ghost" onClick={() => setDate(addDays(date, 1))} aria-label="다음 날">›</Button>
        <Button size="sm" variant="ghost" onClick={() => setDate(todayKst())}>오늘</Button>
        <Select className="!w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">전체 상태</option>
          <option value="PENDING">승인 대기</option>
          <option value="CONFIRMED">예약 확정</option>
          <option value="VISITED">방문 완료</option>
          <option value="NO_SHOW">노쇼</option>
          <option value="CANCELLED_BY_USER">고객 취소</option>
          <option value="CANCELLED_SAFETY">안전 취소</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={reload}>새로고침</Button>
      </div>
      <Msg msg={msg} />
      <ErrorBox error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title={`${md(date + 'T00:00:00+09:00')} 예약이 없어요`} pose="resting" />
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {data.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <span className="w-14 text-lg font-extrabold">{hm(r.slotStartAt)}</span>
                <Badge tone={TONE[r.status] ?? 'gray'}>{r.statusLabel}</Badge>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold">
                  {r.customerName} · {r.partySize}명 <span className="font-mono text-xs text-muted">{r.code}</span>
                </p>
                <p className="truncate text-muted">{r.items}</p>
                <p className="text-xs text-muted">
                  정가 {won(r.subtotal)} → <b className="text-forest">현장 결제 {won(r.totalAmount)}</b> ({r.discountRate}% · -{won(r.discountAmount)})
                  {r.customerPhone && ` · ${r.customerPhone}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.status === 'PENDING' && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => act(r, 'APPROVE')}>승인</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(r, 'REJECT')}>거절</Button>
                  </>
                )}
                {r.status === 'CONFIRMED' && (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(r, 'NO_SHOW')}>노쇼</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(r, 'CANCEL_BY_STORE')}>매장 취소</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">결제는 현장에서 진행돼요. 표시 금액은 예약 시점 할인 조건으로 계산된 금액이에요.</p>
    </Card>
  );
}
