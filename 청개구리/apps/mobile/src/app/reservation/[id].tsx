// 예약 완료 / 예약 상세: 예약번호, QR, 매장 정보, 방문 일시, 할인 내역, 취소
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '@/lib/api';
import { dt, useData, won } from '@/lib/hooks';
import { Badge, Button, Card, colors, ErrorView, Frog, Loading, Screen, T } from '@/components/ui';

interface Detail {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  partySize: number;
  slotStartAt: string;
  durationMinutes: number;
  campaignKindLabel: string;
  campaignTitle: string;
  discountRate: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  statusReason: string | null;
  items: Array<{ name: string; quantity: number; unitPrice: number; discountRate: number; lineSubtotal: number }>;
  store: { id: string; name: string; address: string; phone: string | null };
  qrToken: string | null;
}

const ask = (title: string, msg: string) =>
  new Promise<boolean>((resolve) => {
    if (Platform.OS === 'web') return resolve(globalThis.confirm?.(`${title}\n${msg}`) ?? false);
    Alert.alert(title, msg, [
      { text: '아니요', style: 'cancel', onPress: () => resolve(false) },
      { text: '취소할게요', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });

export default function ReservationScreen() {
  const { id, done } = useLocalSearchParams<{ id: string; done?: string }>();
  const { data: r, loading, error, reload, setData } = useData<Detail>(`reservations/${id}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !r) return <Loading />;
  if (error || !r) return <ErrorView message={error?.message ?? '예약을 찾을 수 없어요.'} onRetry={reload} />;
  const active = r.status === 'PENDING' || r.status === 'CONFIRMED';

  return (
    <Screen edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        {done && active && (
          <View style={{ alignItems: 'center', gap: 4, paddingVertical: 8 }}>
            <Frog pose="jumping" size={110} />
            <T size="xl" weight="heavy">{r.status === 'CONFIRMED' ? '예약이 확정됐어요!' : '예약을 요청했어요'}</T>
            <T size="sm" color={colors.muted}>{r.status === 'CONFIRMED' ? '방문할 때 아래 QR을 보여주세요.' : '매장이 승인하면 QR이 발급돼요. (30분 내 미승인 시 자동 취소)'}</T>
          </View>
        )}

        <Card style={{ alignItems: 'center', gap: 10 }}>
          <Badge text={r.statusLabel} bg={r.status === 'CONFIRMED' ? colors.mint : r.status === 'PENDING' ? '#FFF3C4' : colors.surface} fg={r.status === 'CONFIRMED' ? colors.greenDark : colors.muted} />
          {r.qrToken ? (
            <View style={{ padding: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line }} accessible accessibilityLabel="예약 QR 코드">
              <QRCode value={r.qrToken} size={200} color={colors.forest} />
            </View>
          ) : (
            <View style={{ width: 224, height: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderRadius: 16 }}>
              <T size="sm" color={colors.muted} style={{ textAlign: 'center' }}>{r.status === 'PENDING' ? '승인 후 QR이 표시돼요' : '사용할 수 없는 예약이에요'}</T>
            </View>
          )}
          <T size="xs" color={colors.muted}>예약번호</T>
          <T size="xl" weight="heavy" style={{ letterSpacing: 2 }}>{r.code}</T>
          {r.statusReason && <T size="sm" color={colors.danger}>사유: {r.statusReason}</T>}
        </Card>

        <Card style={{ gap: 4 }}>
          <T weight="bold" size="lg">{r.store.name}</T>
          <T size="sm" color={colors.muted}>{r.store.address}</T>
          {r.store.phone && <T size="sm" color={colors.muted}>☎ {r.store.phone}</T>}
          <T style={{ marginTop: 6 }}>📅 {dt(r.slotStartAt)} · {r.partySize}명</T>
          <Button title="매장 보기" variant="ghost" small style={{ alignSelf: 'flex-start', marginTop: 4 }} onPress={() => router.push(`/store/${r.store.id}`)} />
        </Card>

        <Card style={{ gap: 4 }}>
          <T weight="bold">할인 내역 · {r.campaignKindLabel} {r.discountRate}%</T>
          {r.items.map((i, k) => (
            <View key={k} style={{ flexDirection: 'row' }}>
              <T size="sm" style={{ flex: 1 }}>{i.name} × {i.quantity}{i.discountRate ? '' : ' (할인 제외)'}</T>
              <T size="sm">{won(i.lineSubtotal)}</T>
            </View>
          ))}
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 4 }} />
          <View style={{ flexDirection: 'row' }}><T style={{ flex: 1 }}>정상가</T><T>{won(r.subtotal)}</T></View>
          <View style={{ flexDirection: 'row' }}><T style={{ flex: 1 }} color={colors.greenDark}>할인</T><T color={colors.greenDark}>−{won(r.discountAmount)}</T></View>
          <View style={{ flexDirection: 'row' }}><T weight="bold" style={{ flex: 1 }}>현장 결제 금액</T><T size="lg" weight="heavy">{won(r.totalAmount)}</T></View>
          <T size="xs" color={colors.subtle}>확정된 할인은 이후 날씨나 매장 할인 변경과 관계없이 그대로 적용돼요.</T>
        </Card>

        {err && <T weight="bold" color={colors.danger}>{err}</T>}
        {active && (
          <Button
            title="예약 취소"
            variant="danger"
            loading={busy}
            onPress={async () => {
              if (!(await ask('예약을 취소할까요?', '방문 전 취소는 무료예요.'))) return;
              setBusy(true);
              try {
                const next = await api<Detail>(`reservations/${r.id}/cancel`, { body: {} });
                setData(next);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        <Button title="예약 내역으로" variant="ghost" onPress={() => router.replace('/(tabs)/reservations')} />
      </ScrollView>
    </Screen>
  );
}
