import { router } from 'expo-router';
import { View } from 'react-native';
import { formatDistance } from '@cheong/core';
import { Badge, Card, colors, DiscountTag, StoreThumb, T } from './ui';
import { hm, isToday, md } from '@/lib/hooks';

export interface StoreItem {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  lat: number;
  lng: number;
  priceLevel: number;
  isSample: boolean;
  operationPaused: boolean;
  distanceMeters: number | null;
  region: { id: string; name: string; mode: string; isMock: boolean };
  liveRate: number | null;
  liveKinds: string[];
  rainPreviewRate: number | null;
  typhoonMaxRate: number | null;
  bookable: boolean;
  nextSlot: { slotId: string; startAt: string; rate: number; kind: string } | null;
  isFavorite: boolean;
}

export function StoreCard({ s }: { s: StoreItem }) {
  const rate = s.nextSlot?.rate ?? s.liveRate;
  return (
    <Card onPress={() => router.push(`/store/${s.id}`)} label={`${s.name}, ${rate ? `${rate}% 할인` : '할인 대기'}`} style={{ flexDirection: 'row', gap: 12 }}>
      <StoreThumb category={s.category} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {rate ? <DiscountTag rate={rate} kind={s.nextSlot?.kind ?? s.liveKinds[0]} /> : null}
          <T weight="bold" numberOfLines={1} style={{ flex: 1 }}>{s.name}</T>
        </View>
        <T size="xs" color={colors.muted}>
          {s.categoryLabel} · {'₩'.repeat(s.priceLevel)}
          {s.distanceMeters !== null ? ` · ${formatDistance(s.distanceMeters)}` : ''}
        </T>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {s.operationPaused ? (
            <Badge text="잠시 영업 중단" bg={colors.dangerBg} fg={colors.danger} />
          ) : s.bookable && s.nextSlot ? (
            <Badge text={`예약 가능 · ${isToday(s.nextSlot.startAt) ? '오늘' : md(s.nextSlot.startAt)} ${hm(s.nextSlot.startAt)}~`} bg={colors.mint} fg={colors.greenDark} />
          ) : s.rainPreviewRate ? (
            <Badge text={`비 오면 ${s.rainPreviewRate}% 할인`} bg="#EAF1FD" fg={colors.info} />
          ) : (
            <Badge text="예약 마감" />
          )}
          {s.typhoonMaxRate && (s.region.mode === 'TYPHOON_WATCH' || s.region.mode === 'RECOVERY') ? (
            <Badge text={`태풍 특가 최대 ${s.typhoonMaxRate}%`} bg={colors.typhoonBg} fg={colors.typhoon} />
          ) : null}
          {s.isSample && <Badge text="샘플" bg="#FFF0E0" fg={colors.mock} />}
        </View>
      </View>
    </Card>
  );
}
