'use client';

import { useState } from 'react';
import { Button, Field, Input, Msg, Select, Textarea, useAction } from '../ui';

export const CATEGORIES: Array<[string, string]> = [
  ['KOREAN', '한식'],
  ['CAFE', '카페'],
  ['WESTERN', '양식'],
  ['JAPANESE', '일식'],
  ['CHINESE', '중식'],
  ['BAR', '주점'],
  ['BAKERY', '베이커리'],
  ['ETC', '기타'],
];
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export type Hours = Array<{ open: string; close: string } | null>;

export interface StoreFormValue {
  name: string;
  category: string;
  description: string;
  address: string;
  lat: string;
  lng: string;
  phone: string;
  priceLevel: number;
  businessHours: Hours;
  autoApprove: boolean;
  imageUrls: string;
  businessNumber?: string;
  representativeName?: string;
}

export const emptyStore = (): StoreFormValue => ({
  name: '',
  category: 'KOREAN',
  description: '',
  address: '',
  lat: '',
  lng: '',
  phone: '',
  priceLevel: 2,
  businessHours: Array.from({ length: 7 }, () => ({ open: '11:00', close: '21:00' })),
  autoApprove: true,
  imageUrls: '',
  businessNumber: '',
  representativeName: '',
});

export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  return (
    <div className="space-y-1.5">
      {DAYS.map((d, i) => {
        const h = value[i];
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-6 font-bold">{d}</span>
            <label className="flex min-h-9 items-center gap-1">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#45B96B]"
                checked={!!h}
                onChange={(e) => {
                  const next = [...value];
                  next[i] = e.target.checked ? { open: '11:00', close: '21:00' } : null;
                  onChange(next);
                }}
              />
              영업
            </label>
            {h ? (
              <>
                <Input type="time" className="!w-28 !min-h-9" value={h.open} onChange={(e) => { const n = [...value]; n[i] = { ...h, open: e.target.value }; onChange(n); }} />
                ~
                <Input type="time" className="!w-28 !min-h-9" value={h.close} onChange={(e) => { const n = [...value]; n[i] = { ...h, close: e.target.value }; onChange(n); }} />
              </>
            ) : (
              <span className="text-muted">휴무</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StoreForm({
  initial,
  withBusiness,
  submitLabel,
  onSubmit,
}: {
  initial: StoreFormValue;
  withBusiness?: boolean;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [f, setF] = useState(initial);
  const { busy, msg, run } = useAction();
  const set = <K extends keyof StoreFormValue>(k: K, v: StoreFormValue[K]) => setF((p) => ({ ...p, [k]: v }));

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, unknown> = {
          name: f.name,
          category: f.category,
          description: f.description,
          address: f.address,
          lat: Number(f.lat),
          lng: Number(f.lng),
          phone: f.phone || null,
          priceLevel: Number(f.priceLevel),
          businessHours: f.businessHours,
          autoApprove: f.autoApprove,
          imageUrls: f.imageUrls.split('\n').map((s) => s.trim()).filter(Boolean),
        };
        if (withBusiness) Object.assign(body, { businessNumber: f.businessNumber, representativeName: f.representativeName });
        await run(() => onSubmit(body), '저장했어요.');
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="매장명">
          <Input required maxLength={40} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="음식 종류">
          <Select value={f.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="주소">
          <Input required value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="전화번호 (선택)">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="위도" hint="지도 API 연동 전까지 직접 입력 (예: 35.2205)">
          <Input required inputMode="decimal" value={f.lat} onChange={(e) => set('lat', e.target.value)} />
        </Field>
        <Field label="경도" hint="예: 129.0838">
          <Input required inputMode="decimal" value={f.lng} onChange={(e) => set('lng', e.target.value)} />
        </Field>
        <Field label="가격대">
          <Select value={f.priceLevel} onChange={(e) => set('priceLevel', Number(e.target.value))}>
            <option value={1}>₩ (1만원 이하)</option>
            <option value={2}>₩₩ (1~2만원)</option>
            <option value={3}>₩₩₩ (2만원 이상)</option>
          </Select>
        </Field>
        <Field label="예약 승인 방식">
          <Select value={f.autoApprove ? '1' : '0'} onChange={(e) => set('autoApprove', e.target.value === '1')}>
            <option value="1">자동 승인 (바로 확정)</option>
            <option value="0">점주 승인 후 확정 (30분 내 미승인 시 자동 취소)</option>
          </Select>
        </Field>
      </div>
      <Field label="매장 소개">
        <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label="사진 주소 (한 줄에 하나, https)" hint="사진 업로드 저장소 연동 전까지 이미지 URL 로 등록해요.">
        <Textarea rows={2} value={f.imageUrls} onChange={(e) => set('imageUrls', e.target.value)} />
      </Field>
      <Field label="영업시간">
        <HoursEditor value={f.businessHours} onChange={(h) => set('businessHours', h)} />
      </Field>
      {withBusiness && (
        <div className="grid gap-3 rounded-xl bg-surface p-3 sm:grid-cols-2">
          <Field label="사업자등록번호" hint="형식만 검증해요. 진위 확인은 운영팀이 승인 시 진행합니다.">
            <Input required placeholder="000-00-00000" value={f.businessNumber} onChange={(e) => set('businessNumber', e.target.value)} />
          </Field>
          <Field label="대표자명">
            <Input required value={f.representativeName} onChange={(e) => set('representativeName', e.target.value)} />
          </Field>
        </div>
      )}
      <Msg msg={msg} />
      <Button size="lg" disabled={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
