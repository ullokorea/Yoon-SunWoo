// 예약: 방문 시간·인원·메뉴 선택 → 서버 견적 → 조건 확인 → 확정
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { dt, useData, won } from '@/lib/hooks';
import { Badge, Button, Card, colors, DiscountTag, ErrorView, Loading, Screen, T } from '@/components/ui';
import type { StoreDetail } from '../store/[id]';

interface Quote {
  lines: Array<{ menuId: string; name: string; quantity: number; unitPrice: number; discountRate: number; lineSubtotal: number; lineDiscount: number }>;
  subtotal: number;
  discount: number;
  total: number;
  discountCapped: boolean;
  appliedRate: number;
}

function Stepper({ value, onChange, min = 0, max = 20, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const btn = (txt: string, next: number, disabled: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${txt === '+' ? '늘리기' : '줄이기'}`} disabled={disabled} onPress={() => onChange(next)}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
      <T size="lg" weight="bold">{txt}</T>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {btn('−', value - 1, value <= min)}
      <T weight="bold" style={{ minWidth: 24, textAlign: 'center' }}>{value}</T>
      {btn('+', value + 1, value >= max)}
    </View>
  );
}

export default function Reserve() {
  const { storeId, slotId, campaignId } = useLocalSearchParams<{ storeId: string; slotId: string; campaignId: string }>();
  const { data: s, loading, error, reload } = useData<StoreDetail>(`stores/${storeId}`);
  const [party, setParty] = useState(2);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const slot = s?.slots.find((x) => x.id === slotId);
  const campaign = s?.campaigns.find((c) => c.id === campaignId);
  const items = useMemo(() => Object.entries(qty).filter(([, q]) => q > 0).map(([menuId, quantity]) => ({ menuId, quantity })), [qty]);

  // 서버 견적 (가격은 항상 서버가 계산)
  useEffect(() => {
    if (!items.length) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    const t = setTimeout(() => {
      api<Quote>('reservations/quote', { body: { storeId, slotId, campaignId, partySize: party, items } })
        .then((q) => {
          setQuote(q);
          setQuoteErr(null);
        })
        .catch((e: ApiError) => {
          setQuote(null);
          setQuoteErr(e.message);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [items, party, storeId, slotId, campaignId]);

  if (loading && !s) return <Loading />;
  if (error || !s) return <ErrorView message={error?.message ?? '매장 정보를 불러오지 못했어요.'} onRetry={reload} />;
  if (!slot || !campaign) {
    return <ErrorView message="선택한 시간 또는 할인이 더 이상 유효하지 않아요. 매장 화면에서 다시 선택해 주세요." onRetry={() => router.back()} />;
  }
  if (!slot.offer) return <ErrorView message={slot.blockReason ?? '지금은 이 시간을 예약할 수 없어요.'} onRetry={() => router.back()} />;

  const eligible = (menuId: string) => campaign.scope === 'ALL' || campaign.menuIds.includes(menuId);

  const submit = async () => {
    setBusy(true);
    setSubmitErr(null);
    try {
      const r = await api<{ id: string }>('reservations', { body: { storeId, slotId, campaignId, partySize: party, items } });
      router.replace({ pathname: '/reservation/[id]', params: { id: r.id, done: '1' } });
    } catch (e) {
      setSubmitErr((e as Error).message);
      void reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <Card style={{ gap: 6 }}>
          <T weight="heavy" size="lg">{s.name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <DiscountTag rate={campaign.rate} kind={campaign.kind} />
            <T weight="bold">{campaign.title}</T>
          </View>
          <T>📅 {dt(slot.startAt)} 방문 · 남은 자리 {slot.remaining}석</T>
        </Card>

        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <T weight="bold">방문 인원</T>
            <T size="xs" color={colors.muted}>이 할인은 최대 {Math.min(campaign.maxPartySize, slot.remaining)}명</T>
          </View>
          <Stepper label="인원" value={party} min={1} max={Math.min(campaign.maxPartySize, slot.remaining)} onChange={setParty} />
        </Card>

        <Card style={{ gap: 6 }}>
          <T weight="bold">메뉴 선택</T>
          <T size="xs" color={colors.muted}>할인 메뉴를 1개 이상 골라 주세요. 현장에서 추가 주문도 할 수 있어요 (추가분은 할인 미적용).</T>
          {s.menus.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <T weight="bold">{m.isSet ? '🎁 ' : ''}{m.name}</T>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <T size="sm" color={colors.muted}>{won(m.price)}</T>
                  {eligible(m.id) ? <Badge text={`${campaign.rate}% 할인`} bg="#FFF3C4" fg={colors.yellowDark} /> : <Badge text="할인 제외" />}
                </View>
              </View>
              <Stepper label={m.name} value={qty[m.id] ?? 0} max={20} onChange={(n) => setQty({ ...qty, [m.id]: n })} />
            </View>
          ))}
        </Card>

        <Card style={{ gap: 6 }}>
          <T weight="bold">결제 예정 금액 (현장 결제)</T>
          {!items.length ? (
            <T size="sm" color={colors.muted}>메뉴를 선택하면 서버에서 할인 금액을 계산해요.</T>
          ) : quoteErr ? (
            <T size="sm" weight="bold" color={colors.danger}>{quoteErr}</T>
          ) : !quote ? (
            <Loading label="금액 계산 중…" />
          ) : (
            <>
              {quote.lines.map((l) => (
                <View key={l.menuId} style={{ flexDirection: 'row' }}>
                  <T size="sm" style={{ flex: 1 }}>{l.name} × {l.quantity}</T>
                  <T size="sm">{won(l.lineSubtotal)}</T>
                </View>
              ))}
              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 4 }} />
              <View style={{ flexDirection: 'row' }}><T style={{ flex: 1 }}>정상가</T><T>{won(quote.subtotal)}</T></View>
              <View style={{ flexDirection: 'row' }}><T style={{ flex: 1 }} color={colors.greenDark}>할인 ({quote.appliedRate}%)</T><T weight="bold" color={colors.greenDark}>−{won(quote.discount)}</T></View>
              {quote.discountCapped && <T size="xs" color={colors.muted}>최대 할인 금액 {won(campaign.maxDiscountAmount)}이 적용됐어요.</T>}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}><T weight="bold" style={{ flex: 1 }}>할인가</T><T size="xl" weight="heavy">{won(quote.total)}</T></View>
            </>
          )}
        </Card>

        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agree }} onPress={() => setAgree(!agree)} style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surface }}>
          <T size="lg">{agree ? '☑️' : '⬜'}</T>
          <T size="sm" style={{ flex: 1 }}>
            예약 조건을 확인했어요: 방문 시 매장에서 결제 · {campaign.dailyStartTime}~{campaign.dailyEndTime} 방문에만 할인 · 방문 전까지 무료 취소 · 노쇼 시 이용이 제한될 수 있음
            {!s.autoApprove ? ' · 점주 승인 후 확정 (30분 내 미승인 시 자동 취소)' : ''}
          </T>
        </Pressable>
        {submitErr && <T weight="bold" color={colors.danger}>{submitErr}</T>}
        <Button title={s.autoApprove ? '예약 확정하기' : '예약 요청하기'} loading={busy} disabled={!quote || !agree} onPress={submit} />
      </ScrollView>
    </Screen>
  );
}
