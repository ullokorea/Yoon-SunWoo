import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { FrogPose } from '@cheong/design-tokens';
import { useApp } from '@/lib/app-state';
import { Button, colors, Frog, Screen, T } from '@/components/ui';

const PAGES: Array<{ pose: FrogPose; title: string; body: string }> = [
  { pose: 'jumping', title: '비가 오면,\n혜택이 쏟아져요', body: '비 오는 날, 우리 동네 음식점과 카페가 직접 정한 할인을 예약할 수 있어요.' },
  { pose: 'preparing', title: '내 동네가\n비 올 때만 열려요', body: '매장 위치의 실시간 강수를 확인해 할인이 열려요. 한 번 확정한 예약은 비가 그쳐도 그대로예요.' },
  { pose: 'sheltering', title: '태풍 땐\n안전이 먼저', body: '위험한 날엔 예약을 멈추고, 태풍 전·후 안전한 시간에만 특가를 열어요.' },
];

export default function Onboarding() {
  const { setOnboarded, requestLocation } = useApp();
  const [i, setI] = useState(0);
  const [step, setStep] = useState<'intro' | 'permission'>('intro');
  const [busy, setBusy] = useState(false);

  const finish = async (path: '/(tabs)' | '/login' | '/signup') => {
    await setOnboarded();
    router.replace('/(tabs)');
    if (path !== '/(tabs)') router.push(path);
  };

  if (step === 'permission') {
    return (
      <Screen edges={['top', 'bottom']} style={{ padding: 24, justifyContent: 'space-between' }}>
        <View style={{ alignItems: 'center', marginTop: 40, gap: 12 }}>
          <Frog pose="preparing" size={140} />
          <T size="xl" weight="heavy" style={{ textAlign: 'center' }}>내 주변 비 소식을 알려드릴게요</T>
          <View style={{ gap: 10, alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: 16, padding: 16 }}>
            <T size="sm"><T size="sm" weight="bold">📍 위치 (선택)</T>{'\n'}주변 매장 거리와 지역 날씨 확인에만 써요. 거부해도 지역을 직접 고를 수 있어요.</T>
            <T size="sm"><T size="sm" weight="bold">🔔 알림 (선택)</T>{'\n'}비 시작·관심 매장 할인·예약 소식을 보내요. 마이페이지에서 언제든 끌 수 있어요.</T>
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <Button
            title="위치 허용하고 시작"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              const ok = await requestLocation();
              setBusy(false);
              if (!ok) {
                await setOnboarded();
                router.replace('/(tabs)');
                router.push('/region');
                return;
              }
              await finish('/(tabs)');
            }}
          />
          <Button title="지역 직접 선택" variant="ghost" onPress={async () => { await setOnboarded(); router.replace('/(tabs)'); router.push('/region'); }} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="로그인" variant="secondary" style={{ flex: 1 }} onPress={() => finish('/login')} />
            <Button title="회원가입" variant="secondary" style={{ flex: 1 }} onPress={() => finish('/signup')} />
          </View>
        </View>
      </Screen>
    );
  }

  const p = PAGES[i]!;
  return (
    <Screen edges={['top', 'bottom']} style={{ padding: 24, justifyContent: 'space-between', backgroundColor: colors.mint }}>
      <View style={{ alignItems: 'flex-end' }}>
        <Button title="건너뛰기" variant="ghost" small onPress={() => setStep('permission')} />
      </View>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <Frog pose={p.pose} size={190} />
        <T size="xxl" weight="heavy" style={{ textAlign: 'center' }}>{p.title}</T>
        <T color={colors.muted} style={{ textAlign: 'center' }}>{p.body}</T>
      </View>
      <View style={{ gap: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }} accessibilityLabel={`${i + 1} / ${PAGES.length}`}>
          {PAGES.map((_, k) => (
            <View key={k} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? colors.green : '#B9DCC7' }} />
          ))}
        </View>
        <Button title={i < PAGES.length - 1 ? '다음' : '시작하기'} onPress={() => (i < PAGES.length - 1 ? setI(i + 1) : setStep('permission'))} />
      </View>
    </Screen>
  );
}
