import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useApp } from '@/lib/app-state';
import { dt, useData, won } from '@/lib/hooks';
import { Badge, Button, Card, Chip, colors, DiscountTag, Empty, ErrorView, Loading, Screen, T } from '@/components/ui';

interface Row {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  tab: 'upcoming' | 'visited' | 'cancelled' | 'noshow';
  storeName: string;
  slotStartAt: string;
  partySize: number;
  discountRate: number;
  totalAmount: number;
  campaignKind: string;
}

const TABS = [
  ['upcoming', '예약 예정'],
  ['visited', '방문 완료'],
  ['cancelled', '취소'],
  ['noshow', '노쇼'],
] as const;

export default function Reservations() {
  const { me } = useApp();
  const [tab, setTab] = useState<Row['tab']>('upcoming');
  const { data, loading, error, refreshing, reload } = useData<Row[]>(me ? 'reservations' : null);

  if (!me) {
    return (
      <Screen>
        <Empty title="로그인하고 예약을 확인하세요" pose="preparing" action={<Button title="로그인" style={{ marginTop: 8, alignSelf: 'stretch' }} onPress={() => router.push('/login')} />} />
      </Screen>
    );
  }
  const rows = (data ?? []).filter((r) => r.tab === tab);
  if (tab === 'upcoming') rows.sort((a, b) => a.slotStartAt.localeCompare(b.slotStartAt));
  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
        <T size="xl" weight="heavy">예약 내역</T>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) => (
            <Chip key={k} label={`${l} ${(data ?? []).filter((r) => r.tab === k).length}`} active={tab === k} onPress={() => setTab(k)} />
          ))}
        </View>
      </View>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorView message={error.message} onRetry={reload} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshing={refreshing}
          onRefresh={reload}
          ListEmptyComponent={<Empty title={tab === 'upcoming' ? '예정된 예약이 없어요' : '내역이 없어요'} sub={tab === 'upcoming' ? '비 오는 날 할인 매장을 찾아보세요.' : undefined} pose="resting" />}
          renderItem={({ item: r }) => (
            <Card onPress={() => router.push(`/reservation/${r.id}`)} label={`${r.storeName} 예약 ${r.statusLabel}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <DiscountTag rate={r.discountRate} kind={r.campaignKind} />
                <T weight="bold" style={{ flex: 1 }} numberOfLines={1}>{r.storeName}</T>
                <Badge text={r.statusLabel} bg={r.status === 'CONFIRMED' ? colors.mint : r.status === 'PENDING' ? '#FFF3C4' : colors.surface} fg={r.status === 'CONFIRMED' ? colors.greenDark : r.status === 'PENDING' ? colors.yellowDark : colors.muted} />
              </View>
              <T size="sm" color={colors.muted} style={{ marginTop: 6 }}>
                {dt(r.slotStartAt)} · {r.partySize}명 · 현장 결제 {won(r.totalAmount)}
              </T>
              <T size="xs" color={colors.subtle}>{r.code}</T>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
