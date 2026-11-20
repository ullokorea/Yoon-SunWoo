import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { formatDistance, distanceMeters } from '@cheong/core';
import { api } from '@/lib/api';
import { DEFAULT_PLACE, useApp } from '@/lib/app-state';
import { dayKey, hm, isToday, md, useData, won } from '@/lib/hooks';
import { Badge, Button, Card, Chip, colors, DiscountTag, ErrorView, Loading, MockNotice, Screen, StoreThumb, T, themeOf } from '@/components/ui';

export interface StoreDetail {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  description: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  priceLevel: number;
  businessHours: Array<{ open: string; close: string } | null>;
  operationPaused: boolean;
  isSample: boolean;
  autoApprove: boolean;
  isFavorite: boolean;
  region: { name: string; mode: string; isMock: boolean; copy: { headline: string; sub: string } };
  menus: Array<{ id: string; name: string; description: string; price: number; isSet: boolean }>;
  campaigns: Array<{
    id: string; kind: string; kindLabel: string; title: string; rate: number; scope: 'ALL' | 'MENUS'; menuIds: string[];
    dailyStartTime: string; dailyEndTime: string; validUntil: string; maxDiscountAmount: number | null; minOrderAmount: number; maxPartySize: number; dailyLimit: number | null; live: boolean;
  }>;
  slots: Array<{ id: string; startAt: string; remaining: number; offer: { campaignId: string; kind: string; kindLabel: string; rate: number; title: string } | null; blockReason: string | null }>;
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function StoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, place } = useApp();
  const p = place ?? DEFAULT_PLACE;
  const { data: s, loading, error, reload, setData } = useData<StoreDetail>(`stores/${id}`);
  const [day, setDay] = useState<string | null>(null);

  const days = useMemo(() => [...new Set((s?.slots ?? []).map((x) => dayKey(x.startAt)))], [s]);
  const activeDay = day ?? days.find((d) => s?.slots.some((x) => dayKey(x.startAt) === d && x.offer)) ?? days[0];

  if (loading && !s) return <Loading />;
  if (error || !s) return <ErrorView message={error?.message ?? '매장을 찾을 수 없어요.'} onRetry={reload} />;

  const theme = themeOf(s.region.mode);
  const daySlots = s.slots.filter((x) => dayKey(x.startAt) === activeDay);
  const bookable = s.slots.filter((x) => x.offer);
  const best = s.campaigns.filter((c) => c.live).sort((a, b) => b.rate - a.rate)[0];

  const toggleFav = async () => {
    if (!me) return router.push('/login');
    setData({ ...s, isFavorite: !s.isFavorite });
    await api(`stores/${s.id}/favorite`, { body: { on: !s.isFavorite } }).catch(reload);
  };

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: s.name,
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={s.isFavorite ? '즐겨찾기 해제' : '즐겨찾기'} onPress={toggleFav} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <T size="xl">{s.isFavorite ? '💚' : '🤍'}</T>
            </Pressable>
          ),
        }}
      />
      {s.isSample && <MockNotice text="[샘플] 개발용 가상 매장이에요. 실제 영업 정보가 아니에요." />}
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={{ backgroundColor: theme.bg, padding: 20, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <StoreThumb category={s.category} size={88} />
          <View style={{ flex: 1, gap: 4 }}>
            <T size="xl" weight="heavy">{s.name}</T>
            <T size="sm" color={colors.muted}>{s.categoryLabel} · {'₩'.repeat(s.priceLevel)} · {formatDistance(distanceMeters(p, s))}</T>
            <Badge text={`${theme.emoji} ${s.region.name} ${theme.label}${s.region.isMock ? ' (MOCK)' : ''}`} bg={colors.white} fg={theme.accent} />
          </View>
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          {s.operationPaused && <Card style={{ backgroundColor: colors.dangerBg, borderColor: colors.dangerBg }}><T weight="bold" color={colors.danger}>매장이 잠시 영업을 중단했어요. 지금은 예약할 수 없어요.</T></Card>}

          {/* 할인 조건 */}
          {s.campaigns.length > 0 && (
            <Card style={{ gap: 10 }}>
              <T weight="bold">할인 혜택</T>
              {s.campaigns.map((c) => (
                <View key={c.id} style={{ gap: 4, opacity: c.live ? 1 : 0.6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <DiscountTag rate={c.rate} kind={c.kind} />
                    <T weight="bold" style={{ flex: 1 }}>{c.title}</T>
                    <Badge text={c.live ? '진행 중' : c.kind === 'RAIN' ? '비 오면 열려요' : '기간 외'} bg={c.live ? colors.mint : colors.surface} fg={c.live ? colors.greenDark : colors.muted} />
                  </View>
                  <T size="xs" color={colors.muted}>
                    {c.kindLabel} · 방문 {c.dailyStartTime}~{c.dailyEndTime} · {c.scope === 'ALL' ? '전체 메뉴' : `지정 메뉴 ${c.menuIds.length}개`} · 최대 {c.maxPartySize}명
                    {c.minOrderAmount ? ` · ${won(c.minOrderAmount)} 이상 주문` : ''}
                    {c.maxDiscountAmount ? ` · 최대 ${won(c.maxDiscountAmount)} 할인` : ''}
                    {c.dailyLimit ? ` · 하루 ${c.dailyLimit}팀 선착순` : ''}
                  </T>
                </View>
              ))}
              <T size="xs" color={colors.subtle}>결제는 방문 시 매장에서 해요. 예약 확정 시점의 할인이 그대로 적용돼요.</T>
            </Card>
          )}

          {/* 예약 가능 시간 */}
          <Card style={{ gap: 10 }}>
            <T weight="bold">예약 가능 시간</T>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {days.map((d) => <Chip key={d} label={isToday(`${d}T12:00:00+09:00`) ? '오늘' : md(`${d}T12:00:00+09:00`)} active={d === activeDay} onPress={() => setDay(d)} />)}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {daySlots.map((x) => (
                <Pressable
                  key={x.id}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !x.offer }}
                  accessibilityLabel={`${hm(x.startAt)} ${x.offer ? `${x.offer.rate}% 할인 예약 가능` : x.blockReason ?? '예약 불가'}`}
                  disabled={!x.offer || !me}
                  onPress={() => router.push({ pathname: '/reserve/[storeId]', params: { storeId: s.id, slotId: x.id, campaignId: x.offer!.campaignId } })}
                  style={{
                    minWidth: 76, minHeight: 56, borderRadius: 12, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center',
                    borderWidth: 1, borderColor: x.offer ? colors.green : colors.line, backgroundColor: x.offer ? colors.mint : colors.surface,
                  }}
                >
                  <T weight="bold" color={x.offer ? colors.forest : colors.subtle}>{hm(x.startAt)}</T>
                  <T size="xs" color={x.offer ? colors.greenDark : colors.subtle}>{x.offer ? `${x.offer.rate}% · ${x.remaining}석` : x.remaining === 0 ? '마감' : '불가'}</T>
                </Pressable>
              ))}
            </View>
            {!bookable.length && (
              <T size="sm" color={colors.muted}>{s.slots.find((x) => x.blockReason)?.blockReason ?? s.region.copy.sub}</T>
            )}
            {!me && bookable.length > 0 && <Button title="로그인하고 예약하기" onPress={() => router.push('/login')} />}
          </Card>

          {/* 메뉴 */}
          <Card style={{ gap: 8 }}>
            <T weight="bold">메뉴</T>
            {s.menus.map((m) => {
              const c = best && (best.scope === 'ALL' || best.menuIds.includes(m.id)) ? best : null;
              return (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
                  <T style={{ flex: 1 }}>{m.isSet ? '🎁 ' : ''}{m.name}</T>
                  {c ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <T size="xs" color={colors.subtle} style={{ textDecorationLine: 'line-through' }}>{won(m.price)}</T>
                      <T weight="heavy" color={colors.greenDark}>{won(m.price - Math.floor((m.price * c.rate) / 100))}</T>
                    </View>
                  ) : (
                    <T weight="bold">{won(m.price)}</T>
                  )}
                </View>
              );
            })}
            {best && <T size="xs" color={colors.subtle}>할인가는 참고용이며 최종 금액은 예약 화면에서 서버가 계산해요.</T>}
          </Card>

          <Card style={{ gap: 4 }}>
            <T weight="bold">매장 정보</T>
            <T size="sm">{s.address}</T>
            {s.phone && <T size="sm">☎ {s.phone}</T>}
            <T size="sm" color={colors.muted}>
              {s.businessHours.map((h, i) => `${DAYS[i]} ${h ? `${h.open}~${h.close}` : '휴무'}`).join('  ·  ')}
            </T>
            <T size="xs" color={colors.subtle}>지도 API 미연동 — 위치: {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</T>
            {s.description ? <T size="sm" color={colors.muted} style={{ marginTop: 6 }}>{s.description}</T> : null}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
