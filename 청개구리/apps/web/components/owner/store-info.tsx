'use client';

import { useState } from 'react';
import { api } from '@/lib/api-client';
import { won } from '@/lib/format';
import { Badge, Button, Card, Field, Input, Msg, useAction } from '../ui';
import { StoreForm, type Hours } from './store-form';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isSet: boolean;
  isAvailable: boolean;
  description: string;
  sortOrder: number;
}

export function OwnerStoreInfo({ storeId, store, onChanged }: { storeId: string; store: Record<string, unknown> & { menus: MenuItem[] }; onChanged: () => void }) {
  const [menuForm, setMenuForm] = useState({ name: '', price: '', isSet: false });
  const { busy, msg, run } = useAction();

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <Card title="매장 정보">
        <StoreForm
          initial={{
            name: String(store.name),
            category: String(store.category),
            description: String(store.description ?? ''),
            address: String(store.address),
            lat: String(store.lat),
            lng: String(store.lng),
            phone: String(store.phone ?? ''),
            priceLevel: Number(store.priceLevel),
            businessHours: store.businessHours as Hours,
            autoApprove: Boolean(store.autoApprove),
            imageUrls: ((store.images as string[]) ?? []).join('\n'),
          }}
          submitLabel="매장 정보 저장"
          onSubmit={async (body) => {
            await api(`owner/stores/${storeId}`, { method: 'PATCH', body });
            onChanged();
          }}
        />
      </Card>
      <Card title="메뉴·가격">
        <ul className="divide-y divide-line">
          {store.menus.map((m) => (
            <li key={m.id} className="flex min-h-12 items-center gap-2 py-2 text-sm">
              <span className={`font-bold ${m.isAvailable ? '' : 'text-subtle line-through'}`}>{m.name}</span>
              {m.isSet && <Badge tone="sun">세트</Badge>}
              <span className="ml-auto font-bold">{won(m.price)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`owner/stores/${storeId}/menus/${m.id}`, { method: 'PATCH', body: { isAvailable: !m.isAvailable } });
                    onChanged();
                  })
                }
              >
                {m.isAvailable ? '품절' : '판매'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const p = window.prompt(`${m.name} 새 가격(원)`, String(m.price));
                  if (!p) return;
                  void run(async () => {
                    await api(`owner/stores/${storeId}/menus/${m.id}`, { method: 'PATCH', body: { price: Number(p.replace(/\D/g, '')) } });
                    onChanged();
                  }, '가격을 바꿨어요. 이미 확정된 예약은 예약 당시 가격이 유지돼요.');
                }}
              >
                가격
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 space-y-2 rounded-xl bg-surface p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              api(`owner/stores/${storeId}/menus`, { body: { name: menuForm.name, price: Number(menuForm.price), isSet: menuForm.isSet, sortOrder: store.menus.length } }),
            );
            if (ok) {
              setMenuForm({ name: '', price: '', isSet: false });
              onChanged();
            }
          }}
        >
          <p className="text-sm font-bold">메뉴 추가</p>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <Field label="메뉴명">
              <Input required value={menuForm.name} onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} />
            </Field>
            <Field label="가격(원)">
              <Input required inputMode="numeric" value={menuForm.price} onChange={(e) => setMenuForm({ ...menuForm, price: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[#45B96B]" checked={menuForm.isSet} onChange={(e) => setMenuForm({ ...menuForm, isSet: e.target.checked })} />
            세트 메뉴
          </label>
          <Button size="sm" disabled={busy}>추가</Button>
        </form>
        <div className="mt-2">
          <Msg msg={msg} />
        </div>
      </Card>
    </div>
  );
}
