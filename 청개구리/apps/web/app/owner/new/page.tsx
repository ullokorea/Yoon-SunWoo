'use client';

import { useRouter } from 'next/navigation';
import { RoleGate, Shell } from '@/components/shell';
import { Card } from '@/components/ui';
import { emptyStore, StoreForm } from '@/components/owner/store-form';
import { api } from '@/lib/api-client';

export default function NewStorePage() {
  const router = useRouter();
  return (
    <RoleGate role="owner">
      {(me) => (
        <Shell title="매장 등록" me={me}>
          <Card title="새 매장 등록">
            <p className="mb-4 text-sm text-muted">등록 후 운영팀이 사업자 정보를 확인하고 승인하면 소비자 앱에 노출돼요.</p>
            <StoreForm
              initial={emptyStore()}
              withBusiness
              submitLabel="등록 신청"
              onSubmit={async (body) => {
                const r = await api<{ id: string }>('owner/stores', { body });
                router.replace(`/owner/${r.id}`);
              }}
            />
          </Card>
        </Shell>
      )}
    </RoleGate>
  );
}
