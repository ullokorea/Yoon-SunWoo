'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RoleGate, Shell, type Me } from '@/components/shell';
import { Badge, Button, Card, Empty, Loading, useApi } from '@/components/ui';

interface OwnerStore {
  id: string;
  name: string;
  status: string;
  statusNote: string | null;
  operationPaused: boolean;
  isSample: boolean;
}

const STATUS: Record<string, [string, 'green' | 'sun' | 'red' | 'gray']> = {
  APPROVED: ['운영 중', 'green'],
  PENDING: ['승인 대기', 'sun'],
  REJECTED: ['반려', 'red'],
  SUSPENDED: ['이용 정지', 'red'],
};

function StoreList({ me }: { me: Me }) {
  const router = useRouter();
  const { data, loading } = useApi<OwnerStore[]>('owner/stores');
  useEffect(() => {
    if (data && data.length === 1 && data[0]!.status === 'APPROVED') router.replace(`/owner/${data[0]!.id}`);
  }, [data, router]);
  return (
    <Shell title="점주 관리자" me={me}>
      <Card
        title="내 매장"
        action={
          <Link href="/owner/new">
            <Button size="sm">+ 매장 등록</Button>
          </Link>
        }
      >
        {loading ? (
          <Loading />
        ) : !data?.length ? (
          <Empty title="아직 등록한 매장이 없어요" sub="매장을 등록하면 운영팀 확인 후 노출돼요." pose="preparing" />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((s) => (
              <li key={s.id}>
                <Link href={`/owner/${s.id}`} className="flex min-h-14 items-center gap-2 py-2 hover:bg-surface">
                  <span className="font-bold">{s.name}</span>
                  <Badge tone={STATUS[s.status]?.[1] ?? 'gray'}>{STATUS[s.status]?.[0] ?? s.status}</Badge>
                  {s.operationPaused && <Badge tone="red">영업 중단</Badge>}
                  {s.statusNote && <span className="text-xs text-muted">사유: {s.statusNote}</span>}
                  <span className="ml-auto text-sm text-muted">관리 →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}

export default function OwnerHome() {
  return <RoleGate role="owner">{(me) => <StoreList me={me} />}</RoleGate>;
}
