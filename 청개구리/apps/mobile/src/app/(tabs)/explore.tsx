// 매장 탐색: 리스트 / 지도(미연동 시 상대 위치 미리보기), 정렬, 필터
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import { DEFAULT_PLACE, useApp } from '@/lib/app-state';
import { useData } from '@/lib/hooks';
import { StoreCard, type StoreItem } from '@/components/store-card';
import { Chip, colors, Empty, ErrorView, Loading, Screen, T } from '@/components/ui';

const CATS: Array<[string, string]> = [['', '전체'], ['KOREAN', '한식'], ['CAFE', '카페'], ['BAR', '주점'], ['BAKERY', '베이커리'], ['JAPANESE', '일식'], ['WESTERN', '양식'], ['CHINESE', '중식']];

/** 지도 API 키가 없으므로 실제 지도 대신 '내 위치 기준 상대 위치'만 보여준다 (지도라고 표시하지 않음) */
function RelativeMap({ stores, center }: { stores: StoreItem[]; center: { lat: number; lng: number } }) {
  const W = 340;
  const pts = stores.map((s) => ({ s, dx: (s.lng - center.lng) * 91000, dy: (s.lat - center.lat) * 111000 }));
  const maxD = Math.max(300, ...pts.map((p) => Math.max(Math.abs(p.dx), Math.abs(p.dy))));
  const scale = (W / 2 - 24) / maxD;
  return (
    <View style={{ padding: 16, gap: 8 }}>
      <View style={{ backgroundColor: '#FFF0E0', padding: 10, borderRadius: 12 }}>
        <T size="xs" weight="bold" color={colors.mock}>지도 API(카카오/네이버) 미연동 — 내 위치 기준 상대 위치 미리보기예요. 실제 지도가 아니에요.</T>
      </View>
      <View style={{ alignItems: 'center' }}>
        <Svg width={W} height={W} viewBox={`0 0 ${W} ${W}`}>
          <Circle cx={W / 2} cy={W / 2} r={W / 2 - 4} fill={colors.mint} />
          <Circle cx={W / 2} cy={W / 2} r={(W / 2 - 4) / 2} fill="none" stroke="#B9DCC7" strokeDasharray="4 4" />
          <Circle cx={W / 2} cy={W / 2} r={7} fill={colors.info} />
          {pts.map(({ s, dx, dy }) => {
            const x = W / 2 + dx * scale;
            const y = W / 2 - dy * scale;
            const rate = s.nextSlot?.rate ?? s.liveRate;
            return (
              <G key={s.id} onPress={() => router.push(`/store/${s.id}`)}>
                <Circle cx={x} cy={y} r={16} fill={s.bookable ? colors.yellow : colors.white} stroke={colors.forest} strokeWidth={1.5} />
                <SvgText x={x} y={y + 4} fontSize={10} fontWeight="bold" fill={colors.forest} textAnchor="middle">{rate ? `${rate}%` : '·'}</SvgText>
              </G>
            );
          })}
        </Svg>
        <T size="xs" color={colors.muted}>점선 원 반경 약 {Math.round(maxD / 2)}m · 노란 원 = 지금 예약 가능</T>
      </View>
    </View>
  );
}

export default function Explore() {
  const { place } = useApp();
  const p = place ?? DEFAULT_PLACE;
  const [view, setView] = useState<'list' | 'map'>('list');
  const [sort, setSort] = useState<'distance' | 'discount'>('distance');
  const [cat, setCat] = useState('');
  const [price, setPrice] = useState(0);
  const [avail, setAvail] = useState(false);
  const q = `stores?lat=${p.lat}&lng=${p.lng}&sort=${sort}${cat ? `&category=${cat}` : ''}${price ? `&priceLevel=${price}` : ''}${avail ? '&availableOnly=true' : ''}`;
  const { data, loading, error, refreshing, reload } = useData<StoreItem[]>(q);

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T size="xl" weight="heavy" style={{ flex: 1 }}>매장 탐색</T>
          <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 12, padding: 3 }}>
            {(['list', 'map'] as const).map((v) => (
              <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: view === v }} onPress={() => setView(v)} style={{ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: view === v ? colors.white : 'transparent' }}>
                <T size="sm" weight="bold" color={view === v ? colors.forest : colors.muted}>{v === 'list' ? '리스트' : '위치'}</T>
              </Pressable>
            ))}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chip label="거리순" active={sort === 'distance'} onPress={() => setSort('distance')} />
          <Chip label="할인율순" active={sort === 'discount'} onPress={() => setSort('discount')} />
          <Chip label="예약 가능만" active={avail} onPress={() => setAvail(!avail)} />
          {[1, 2, 3].map((l) => <Chip key={l} label={'₩'.repeat(l)} active={price === l} onPress={() => setPrice(price === l ? 0 : l)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
          {CATS.map(([k, l]) => <Chip key={k} label={l} active={cat === k} onPress={() => setCat(k)} />)}
        </ScrollView>
      </View>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorView message={error.message} onRetry={reload} />
      ) : view === 'map' ? (
        <ScrollView><RelativeMap stores={data ?? []} center={p} /></ScrollView>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => <StoreCard s={item} />}
          refreshing={refreshing}
          onRefresh={reload}
          ListEmptyComponent={<Empty title="조건에 맞는 매장이 없어요" sub="필터를 바꿔 보세요." pose="thinking" />}
        />
      )}
    </Screen>
  );
}
