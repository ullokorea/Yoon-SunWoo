'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { addDays, kstDay, todayKst } from '@/lib/format';
import { Badge, Button, Card, Empty, Field, Input, Loading, Msg, Select, useAction, useApi } from '../ui';

interface Campaign {
  id: string;
  kind: 'RAIN' | 'TYPHOON_PRE' | 'TYPHOON_RECOVERY';
  kindLabel: string;
  title: string;
  rate: number;
  scope: 'ALL' | 'MENUS';
  menuIds: string[];
  dailyStartTime: string;
  dailyEndTime: string;
  validFrom: string;
  validUntil: string;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  maxPartySize: number;
  dailyLimit: number | null;
  autoActivate: boolean;
  paused: boolean;
  status: string;
  reviewNote: string | null;
}

const LIMITS = { RAIN: [10, 30], TYPHOON_PRE: [10, 50], TYPHOON_RECOVERY: [10, 50] } as const;
const KIND_HELP = {
  RAIN: '비가 오는 동안 오늘 방문 예약에 적용돼요. (10~30%)',
  TYPHOON_PRE: '태풍 접근 예보 단계에서, 태풍 영향 6시간 전까지 끝나는 안전한 시간대 방문에만 적용돼요. 관리자 검수 후 노출. (최대 50%)',
  TYPHOON_RECOVERY: '태풍이 지나간 뒤(특보 해제 + 영업 재개 확인) 방문에 적용돼요. 접근 단계에서 "태풍 다음 날 이후" 방문 사전 예약도 받아요. 관리자 검수 후 노출. (최대 50%)',
};

interface FormState {
  kind: Campaign['kind'];
  title: string;
  rate: number;
  scope: 'ALL' | 'MENUS';
  menuIds: string[];
  dailyStartTime: string;
  dailyEndTime: string;
  validFrom: string;
  validUntil: string;
  maxDiscountAmount: string;
  minOrderAmount: string;
  maxPartySize: string;
  dailyLimit: string;
  autoActivate: boolean;
}

const blank = (kind: Campaign['kind'] = 'RAIN'): FormState => ({
  kind,
  title: kind === 'RAIN' ? '비 오는 날 할인' : kind === 'TYPHOON_PRE' ? '개굴이의 태풍 특가' : '태풍 회복 응원 특가',
  rate: kind === 'RAIN' ? 20 : 40,
  scope: 'ALL',
  menuIds: [],
  dailyStartTime: '11:00',
  dailyEndTime: '21:00',
  validFrom: todayKst(),
  validUntil: addDays(todayKst(), kind === 'RAIN' ? 90 : 14),
  maxDiscountAmount: '',
  minOrderAmount: '0',
  maxPartySize: '4',
  dailyLimit: '',
  autoActivate: true,
});

const fromCampaign = (c: Campaign): FormState => ({
  kind: c.kind,
  title: c.title,
  rate: c.rate,
  scope: c.scope,
  menuIds: c.menuIds,
  dailyStartTime: c.dailyStartTime,
  dailyEndTime: c.dailyEndTime,
  validFrom: kstDay(c.validFrom),
  validUntil: kstDay(c.validUntil),
  maxDiscountAmount: c.maxDiscountAmount?.toString() ?? '',
  minOrderAmount: String(c.minOrderAmount),
  maxPartySize: String(c.maxPartySize),
  dailyLimit: c.dailyLimit?.toString() ?? '',
  autoActivate: c.autoActivate,
});

function CampaignForm({
  storeId,
  menus,
  editing,
  onDone,
}: {
  storeId: string;
  menus: Array<{ id: string; name: string; price: number; isSet: boolean }>;
  editing: Campaign | null;
  onDone: () => void;
}) {
  const [f, setF] = useState<FormState>(editing ? fromCampaign(editing) : blank());
  const { busy, msg, run } = useAction();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const [min, max] = LIMITS[f.kind];

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = {
          kind: f.kind,
          title: f.title,
          rate: Number(f.rate),
          scope: f.scope,
          menuIds: f.menuIds,
          dailyStartTime: f.dailyStartTime,
          dailyEndTime: f.dailyEndTime,
          validFrom: new Date(`${f.validFrom}T00:00:00+09:00`).toISOString(),
          validUntil: new Date(`${f.validUntil}T23:59:59+09:00`).toISOString(),
          maxDiscountAmount: f.maxDiscountAmount ? Number(f.maxDiscountAmount) : null,
          minOrderAmount: Number(f.minOrderAmount || 0),
          maxPartySize: Number(f.maxPartySize || 4),
          dailyLimit: f.dailyLimit ? Number(f.dailyLimit) : null,
          autoActivate: f.autoActivate,
        };
        const ok = await run(() =>
          editing
            ? api(`owner/stores/${storeId}/campaigns/${editing.id}`, { method: 'PATCH', body })
            : api(`owner/stores/${storeId}/campaigns`, { body }),
        );
        if (ok) onDone();
      }}
    >
      {!editing && (
        <Field label="할인 유형">
          <Select value={f.kind} onChange={(e) => setF(blank(e.target.value as Campaign['kind']))}>
            <option value="RAIN">일반 우천 할인 (10~30%)</option>
            <option value="TYPHOON_PRE">개굴이의 태풍 특가 — 태풍 전 안전 시간대 (최대 50%)</option>
            <option value="TYPHOON_RECOVERY">태풍 회복 특가 — 태풍 이후 방문 (최대 50%)</option>
          </Select>
        </Field>
      )}
      <p className="rounded-xl bg-surface p-3 text-xs text-muted">{KIND_HELP[f.kind]}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="할인 이름">
          <Input required maxLength={60} value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label={`할인율 ${f.rate}%`} hint={`${min}~${max}% · 실제 제공하는 할인율만 입력해 주세요`}>
          <input type="range" min={min} max={max} step={1} value={f.rate} onChange={(e) => set('rate', Number(e.target.value))} className="h-11 w-full accent-[#45B96B]" />
        </Field>
        <Field label="적용 시작 시간 (방문 기준)">
          <Input type="time" value={f.dailyStartTime} onChange={(e) => set('dailyStartTime', e.target.value)} />
        </Field>
        <Field label="적용 종료 시간">
          <Input type="time" value={f.dailyEndTime} onChange={(e) => set('dailyEndTime', e.target.value)} />
        </Field>
        <Field label="할인 시작일">
          <Input type="date" value={f.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
        </Field>
        <Field label="할인 종료일">
          <Input type="date" value={f.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
        </Field>
        <Field label="최대 할인 금액 (원, 선택)">
          <Input inputMode="numeric" value={f.maxDiscountAmount} onChange={(e) => set('maxDiscountAmount', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="최소 주문 금액 (원)">
          <Input inputMode="numeric" value={f.minOrderAmount} onChange={(e) => set('minOrderAmount', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="1회 예약 최대 인원">
          <Input inputMode="numeric" value={f.maxPartySize} onChange={(e) => set('maxPartySize', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="하루 최대 할인 예약 건수 (선착순, 비우면 무제한)">
          <Input inputMode="numeric" value={f.dailyLimit} onChange={(e) => set('dailyLimit', e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <Field label="적용 메뉴">
        <Select value={f.scope} onChange={(e) => set('scope', e.target.value as 'ALL' | 'MENUS')}>
          <option value="ALL">전체 메뉴</option>
          <option value="MENUS">특정 메뉴·세트만</option>
        </Select>
      </Field>
      {f.scope === 'MENUS' && (
        <div className="flex flex-wrap gap-2">
          {menus.map((m) => {
            const on = f.menuIds.includes(m.id);
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => set('menuIds', on ? f.menuIds.filter((x) => x !== m.id) : [...f.menuIds, m.id])}
                className={`min-h-10 rounded-full border px-3 text-sm font-bold ${on ? 'border-brand bg-mint text-brand-dark' : 'border-line text-muted'}`}
                aria-pressed={on}
              >
                {m.isSet && '세트 · '}
                {m.name}
              </button>
            );
          })}
        </div>
      )}
      {f.kind === 'RAIN' && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-[#45B96B]" checked={f.autoActivate} onChange={(e) => set('autoActivate', e.target.checked)} />
          비가 오면 자동으로 할인 활성화
        </label>
      )}
      {editing && <p className="text-xs text-muted">수정해도 이미 확정된 예약의 할인 조건은 바뀌지 않아요.{editing.kind !== 'RAIN' && ' 태풍 특가의 할인율·기간을 바꾸면 다시 검수를 받아요.'}</p>}
      <Msg msg={msg} />
      <div className="flex gap-2">
        <Button disabled={busy}>{editing ? '저장' : '할인 등록'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          취소
        </Button>
      </div>
    </form>
  );
}

const STATUS: Record<string, [string, 'green' | 'sun' | 'red' | 'gray']> = {
  APPROVED: ['승인', 'green'],
  PENDING_REVIEW: ['검수 대기', 'sun'],
  REJECTED: ['반려', 'red'],
  SUSPENDED: ['운영 중지', 'red'],
};

export function OwnerDiscounts({ storeId, menus }: { storeId: string; menus: Array<{ id: string; name: string; price: number; isSet: boolean }> }) {
  const { data, loading, reload } = useApi<Campaign[]>(`owner/stores/${storeId}/campaigns`);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const { busy, msg, run } = useAction();

  if (editing) {
    return (
      <Card title={editing === 'new' ? '새 할인 등록' : '할인 수정'}>
        <CampaignForm storeId={storeId} menus={menus} editing={editing === 'new' ? null : editing} onDone={() => { setEditing(null); reload(); }} />
      </Card>
    );
  }
  return (
    <Card title="할인 관리" action={<Button size="sm" onClick={() => setEditing('new')}>+ 할인 등록</Button>}>
      <Msg msg={msg} />
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="등록된 할인이 없어요" sub="비 오는 날 우천 할인부터 시작해 보세요." pose="preparing" />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((c) => {
            const ended = new Date(c.validUntil) < new Date();
            return (
              <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <span className={`text-2xl font-extrabold ${c.kind === 'RAIN' ? 'text-rain' : 'text-typhoon'}`}>{c.rate}%</span>
                  <Badge tone={c.kind === 'RAIN' ? 'blue' : 'purple'}>{c.kindLabel}</Badge>
                  <Badge tone={STATUS[c.status]?.[1] ?? 'gray'}>{STATUS[c.status]?.[0] ?? c.status}</Badge>
                  {c.paused && <Badge>일시정지</Badge>}
                  {ended && <Badge>종료</Badge>}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-bold">{c.title}</p>
                  <p className="text-xs text-muted">
                    {kstDay(c.validFrom)} ~ {kstDay(c.validUntil)} · 방문 {c.dailyStartTime}~{c.dailyEndTime} · {c.scope === 'ALL' ? '전체 메뉴' : `메뉴 ${c.menuIds.length}개`}
                    {c.dailyLimit ? ` · 하루 ${c.dailyLimit}건 선착순` : ''}
                    {c.maxDiscountAmount ? ` · 최대 ${c.maxDiscountAmount.toLocaleString()}원` : ''}
                    {c.minOrderAmount ? ` · ${c.minOrderAmount.toLocaleString()}원 이상` : ''}
                  </p>
                  {c.reviewNote && <p className="text-xs text-danger">검수 메모: {c.reviewNote}</p>}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)} disabled={c.status === 'SUSPENDED'}>수정</Button>
                  <Button
                    size="sm"
                    variant={c.paused ? 'primary' : 'ghost'}
                    disabled={busy}
                    onClick={() => run(async () => { await api(`owner/stores/${storeId}/campaigns/${c.id}/pause`, { body: { paused: !c.paused } }); reload(); }, c.paused ? '할인을 다시 시작했어요.' : '할인을 멈췄어요.')}
                  >
                    {c.paused ? '재개' : '중단'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
