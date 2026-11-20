import { router } from 'expo-router';
import { FlatList, Switch, View } from 'react-native';
import { api } from '@/lib/api';
import { DEFAULT_PLACE, useApp } from '@/lib/app-state';
import { useData } from '@/lib/hooks';
import { StoreCard, type StoreItem } from '@/components/store-card';
import { Button, colors, Empty, ErrorView, Loading, Screen, T } from '@/components/ui';

export default function Favorites() {
  const { me, place } = useApp();
  const p = place ?? DEFAULT_PLACE;
  const { data, loading, error, reload, setData, refreshing } = useData<Array<StoreItem & { notify: boolean }>>(me ? `favorites?lat=${p.lat}&lng=${p.lng}` : null);

  if (!me) {
    return (
      <Screen>
        <Empty title="좋아하는 매장을 저장해 두세요" sub="비가 오면 할인 소식을 먼저 알려드려요." pose="preparing" action={<Button title="로그인" style={{ marginTop: 8, alignSelf: 'stretch' }} onPress={() => router.push('/login')} />} />
      </Screen>
    );
  }
  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <T size="xl" weight="heavy">즐겨찾기</T>
      </View>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorView message={error.message} onRetry={reload} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshing={refreshing}
          onRefresh={reload}
          ListEmptyComponent={<Empty title="저장한 매장이 없어요" sub="매장 상세에서 💚 를 눌러 저장하세요." pose="resting" />}
          renderItem={({ item }) => (
            <View style={{ gap: 6 }}>
              <StoreCard s={item} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, minHeight: 44 }}>
                <T size="sm" color={colors.muted}>이 매장 할인 알림</T>
                <Switch
                  accessibilityLabel={`${item.name} 할인 알림`}
                  value={item.notify}
                  trackColor={{ true: colors.green, false: colors.line }}
                  onValueChange={async (v) => {
                    setData((d) => d?.map((x) => (x.id === item.id ? { ...x, notify: v } : x)) ?? null);
                    await api(`stores/${item.id}/favorite`, { body: { on: true, notify: v } }).catch(reload);
                  }}
                />
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
