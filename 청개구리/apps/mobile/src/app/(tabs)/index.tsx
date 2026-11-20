// 메인 홈: 현재 지역·날씨·개굴이·할인 활성화 상태·주변 할인 매장
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { DEFAULT_PLACE, useApp } from '@/lib/app-state';
import { useData } from '@/lib/hooks';
import { StoreCard, type StoreItem } from '@/components/store-card';
import { Badge, Button, colors, Empty, ErrorView, Frog, Loading, MockNotice, MODE_POSE, Screen, T, themeOf } from '@/components/ui';

interface RegionView {
  id: string;
  name: string;
  mode: string;
  isMock: boolean;
  stale: boolean;
  copy: { headline: string; sub: string; bookingOpen: boolean };
  typhoon: { name: string } | null;
}

export default function Home() {
  const { place, locationDenied } = useApp();
  const p = place ?? DEFAULT_PLACE;
  const [region, setRegion] = useState<RegionView | null>(null);
  const [regionErr, setRegionErr] = useState<string | null>(null);
  const stores = useData<StoreItem[]>(`stores?lat=${p.lat}&lng=${p.lng}&sort=discount`);
  const unread = useData<Array<{ readAt: string | null }>>('notifications');

  useEffect(() => {
    api<RegionView | null>(`regions/locate?lat=${p.lat}&lng=${p.lng}`)
      .then((r) => {
        setRegion(r);
        setRegionErr(null);
      })
      .catch((e) => setRegionErr(e.message));
  }, [p.lat, p.lng, stores.data]);

  const mode = region?.mode ?? 'UNKNOWN';
  const theme = themeOf(mode);
  const nearby = (stores.data ?? []).filter((s) => s.distanceMeters === null || s.distanceMeters < 5000);
  const live = nearby.filter((s) => s.bookable);
  const others = nearby.filter((s) => !s.bookable);
  const unreadCount = (unread.data ?? []).filter((n) => !n.readAt).length;

  return (
    <Screen style={{ backgroundColor: theme.bg }}>
      {region?.isMock && <MockNotice text="개발 모드 · 가상(MOCK) 날씨예요. 실제 기상청 데이터가 아니에요." />}
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={stores.refreshing} onRefresh={stores.reload} tintColor={colors.green} />}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="지역 변경" onPress={() => router.push('/region')} style={{ minHeight: 44, justifyContent: 'center', flex: 1 }}>
            <T size="sm" color={colors.muted}>{p.source === 'gps' ? '📍 현재 위치' : '📍 선택한 지역'}</T>
            <T size="lg" weight="heavy">{region?.name ?? p.label} ▾</T>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`알림 ${unreadCount}개`} onPress={() => router.push('/notifications')} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <T size="xl">🔔</T>
            {unreadCount > 0 && (
              <View style={{ position: 'absolute', top: 6, right: 4, backgroundColor: colors.danger, borderRadius: 9, minWidth: 18, paddingHorizontal: 4 }}>
                <T size="xs" weight="bold" color={colors.white} style={{ textAlign: 'center' }}>{unreadCount}</T>
              </View>
            )}
          </Pressable>
        </View>

        {locationDenied && !place && (
          <Pressable onPress={() => router.push('/region')} style={{ marginHorizontal: 20, marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: colors.white }}>
            <T size="sm">위치 권한이 없어 기본 지역을 보여주고 있어요. <T size="sm" weight="bold" color={colors.greenDark}>지역 선택하기 →</T></T>
          </Pressable>
        )}

        {/* 날씨 히어로 */}
        <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20 }}>
          {region ? (
            <>
              <Frog pose={MODE_POSE[mode] ?? 'thinking'} size={170} />
              <Badge center text={`${theme.emoji} ${theme.label}`} bg={colors.white} fg={theme.accent} />
              <T size="xl" weight="heavy" style={{ textAlign: 'center', marginTop: 8 }}>{region.copy.headline}</T>
              <T size="sm" color={colors.muted} style={{ textAlign: 'center', marginTop: 4 }}>{region.copy.sub}</T>
              {(mode === 'TYPHOON_WATCH' || mode === 'RECOVERY' || mode === 'DANGER') && (
                <Button title={mode === 'DANGER' ? '안전 안내 · 태풍 이후 예약 보기' : '개굴이의 태풍 특가 보기 →'} variant={mode === 'DANGER' ? 'ghost' : 'sun'} style={{ marginTop: 12, alignSelf: 'stretch' }} onPress={() => router.push('/typhoon')} />
              )}
            </>
          ) : regionErr ? (
            <ErrorView message={regionErr} />
          ) : (
            <Loading label="날씨 확인 중…" />
          )}
          {region === null && !regionErr && !stores.loading && (
            <T size="sm" color={colors.muted}>이 지역은 아직 서비스 준비 중이에요.</T>
          )}
        </View>

        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 20, gap: 10, minHeight: 300 }}>
          {stores.loading && !stores.data ? (
            <Loading />
          ) : stores.error ? (
            <ErrorView message={stores.error.message} onRetry={stores.reload} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <T size="lg" weight="heavy">{live.length ? `지금 예약 가능한 할인 ${live.length}곳` : '주변 제휴 매장'}</T>
                <Button title="전체 보기" variant="ghost" small onPress={() => router.push('/explore')} />
              </View>
              {live.map((s) => <StoreCard key={s.id} s={s} />)}
              {!live.length && !others.length && <Empty title="주변에 제휴 매장이 아직 없어요" sub="다른 지역을 선택해 보세요." pose="thinking" />}
              {!live.length && others.length > 0 && (
                <T size="sm" color={colors.muted}>
                  {mode === 'CLEAR' || mode === 'RAIN_FORECAST' ? '비가 오면 아래 매장의 할인이 열려요. 즐겨찾기하면 알려드릴게요.' : '지금은 신규 예약을 받을 수 없어요.'}
                </T>
              )}
              {others.slice(0, 10).map((s) => <StoreCard key={s.id} s={s} />)}
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
