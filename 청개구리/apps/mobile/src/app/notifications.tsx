import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, View } from 'react-native';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { dt, useData } from '@/lib/hooks';
import { Button, Card, colors, Empty, ErrorView, Loading, T } from '@/components/ui';

interface Note { id: string; type: string; title: string; body: string; data: { reservationId?: string; storeId?: string } | null; createdAt: string; readAt: string | null; status: string }

export default function Notifications() {
  const { me } = useApp();
  const { data, loading, error, reload } = useData<Note[]>(me ? 'notifications' : null);
  useEffect(() => {
    if (me && data?.some((n) => !n.readAt)) void api('notifications/read', { method: 'POST' }).catch(() => null);
  }, [me, data]);

  if (!me) return <Empty title="로그인하면 알림을 받을 수 있어요" pose="preparing" action={<Button title="로그인" onPress={() => router.push('/login')} />} />;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorView message={error.message} onRetry={reload} />;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      ListHeaderComponent={<T size="xs" color={colors.mock} style={{ marginBottom: 4 }}>푸시 발송은 MOCK 이에요 — 알림은 이 화면(인앱)에서 확인할 수 있어요.</T>}
      ListEmptyComponent={<Empty title="새 알림이 없어요" pose="resting" />}
      renderItem={({ item: n }) => (
        <Card
          label={n.title}
          onPress={n.data?.reservationId ? () => router.push(`/reservation/${n.data!.reservationId}`) : n.data?.storeId ? () => router.push(`/store/${n.data!.storeId}`) : undefined}
          style={{ backgroundColor: n.readAt ? colors.white : colors.mint }}
        >
          <View style={{ gap: 2 }}>
            <T weight="bold">{n.title}</T>
            <T size="sm" color={colors.muted}>{n.body}</T>
            <T size="xs" color={colors.subtle}>{dt(n.createdAt)}</T>
          </View>
        </Card>
      )}
    />
  );
}
