// 태풍 스페셜: 캐릭터, 특가 배너, 안전 상태 안내, 예약 가능 매장, 태풍 이후 방문 예약
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { DEFAULT_PLACE, useApp } from '@/lib/app-state';
import { useData } from '@/lib/hooks';
import { StoreCard, type StoreItem } from '@/components/store-card';
import { Card, colors, Empty, Frog, Loading, MockNotice, Screen, T } from '@/components/ui';

interface RegionView {
  name: string;
  mode: string;
  isMock: boolean;
  copy: { headline: string; sub: string };
  typhoon: { name: string; expectedImpactAt: string; expectedClearAt: string } | null;
}

const SAFETY: Record<string, { title: string; body: string; bg: string; fg: string }> = {
  TYPHOON_WATCH: { title: '태풍 접근 예보', body: '태풍 영향 6시간 전까지 끝나는 안전한 시간대, 그리고 태풍이 지나간 다음 날 이후 방문만 예약할 수 있어요.', bg: colors.typhoonBg, fg: colors.typhoon },
  DANGER: { title: '⚠️ 기상특보 발효 중 — 외출을 자제해 주세요', body: '신규 방문 예약을 멈췄어요. 이미 예약했다면 예약 화면에서 무료로 취소할 수 있어요. 혜택은 태풍이 지나간 뒤 이용할 수 있어요.', bg: colors.dangerBg, fg: colors.danger },
  RECOVERY: { title: '태풍이 지나갔어요', body: '영업 재개를 확인한 매장의 회복 특가가 열려요. 이동 중 낙하물·침수 구간에 주의해 주세요.', bg: '#FFF6D8', fg: '#8A6A00' },
};

const kst = (d: string) => new Date(new Date(d).getTime() + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');

export default function Typhoon() {
  const { place } = useApp();
  const p = place ?? DEFAULT_PLACE;
  const [region, setRegion] = useState<RegionView | null>(null);
  const { data, loading } = useData<StoreItem[]>(`stores?lat=${p.lat}&lng=${p.lng}&sort=discount`);
  useEffect(() => {
    api<RegionView | null>(`regions/locate?lat=${p.lat}&lng=${p.lng}`).then(setRegion).catch(() => setRegion(null));
  }, [p.lat, p.lng]);

  const mode = region?.mode ?? 'UNKNOWN';
  const safety = SAFETY[mode];
  const typhoonStores = (data ?? []).filter((s) => s.typhoonMaxRate);
  const bookable = typhoonStores.filter((s) => s.bookable && s.nextSlot && s.nextSlot.kind !== 'RAIN');
  const maxRate = Math.max(0, ...typhoonStores.map((s) => s.typhoonMaxRate ?? 0));

  return (
    <Screen edges={['bottom']} style={{ backgroundColor: colors.typhoonBg }}>
      {region?.isMock && <MockNotice text="개발 모드 · 가상(MOCK) 태풍 시나리오예요. 실제 기상 정보가 아니에요." />}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', padding: 24, gap: 6 }}>
          <Frog pose={mode === 'RECOVERY' ? 'cheering' : 'sheltering'} size={160} />
          <T size="sm" weight="bold" color={colors.typhoon}>개굴이의 태풍 특가</T>
          <T size="xxl" weight="heavy" style={{ textAlign: 'center' }}>태풍이 예고되면,{'\n'}할인도 커진다!</T>
          {maxRate > 0 && (
            <View style={{ backgroundColor: colors.typhoon, borderRadius: 16, paddingHorizontal: 18, paddingVertical: 8, marginTop: 6 }}>
              <T size="xl" weight="heavy" color={colors.white}>최대 {maxRate}% 특가</T>
            </View>
          )}
          {region?.typhoon && (
            <T size="xs" color={colors.muted} style={{ textAlign: 'center', marginTop: 4 }}>
              {region.typhoon.name} · 영향 예상 {kst(region.typhoon.expectedImpactAt)} ~ {kst(region.typhoon.expectedClearAt)} (KST)
            </T>
          )}
        </View>

        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 }}>
          {safety ? (
            <Card style={{ backgroundColor: safety.bg, borderColor: safety.bg, gap: 4 }}>
              <T weight="heavy" color={safety.fg}>{safety.title}</T>
              <T size="sm">{safety.body}</T>
            </Card>
          ) : (
            <Card><T size="sm">{region ? `${region.name}에는 지금 태풍 소식이 없어요. 태풍 특가는 태풍 접근 예보 때 열려요.` : '지역 날씨를 확인하고 있어요.'}</T></Card>
          )}
          <T size="xs" color={colors.subtle}>청개구리는 태풍이 강할수록 할인을 키우지 않아요. 위험한 시간의 방문은 받지 않고, 태풍 전·후 안전한 시간만 연결해요.</T>

          {loading ? (
            <Loading />
          ) : mode === 'DANGER' ? (
            <Empty title="지금은 집에서 안전하게!" sub="태풍이 지나가면 회복 특가로 다시 만나요." pose="sheltering" />
          ) : (
            <>
              <T size="lg" weight="heavy">{bookable.length ? `예약 가능한 태풍 특가 ${bookable.length}곳` : '태풍 특가 참여 매장'}</T>
              {(bookable.length ? bookable : typhoonStores).map((s) => <StoreCard key={s.id} s={s} />)}
              {!typhoonStores.length && <Empty title="참여 매장이 아직 없어요" pose="thinking" />}
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
