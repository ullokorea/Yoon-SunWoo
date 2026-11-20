// 스플래시: 개굴이 + 로고, 준비되면 온보딩 또는 홈으로
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useApp } from '@/lib/app-state';
import { colors, Frog, T } from '@/components/ui';

export default function Splash() {
  const { ready, onboarded } = useApp();
  const [minDone, setMinDone] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    const t = setTimeout(() => setMinDone(true), 900);
    return () => clearTimeout(t);
  }, [fade]);

  if (ready && minDone) return <Redirect href={onboarded ? '/(tabs)' : '/onboarding'} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ opacity: fade, alignItems: 'center' }}>
        <Frog pose="jumping" size={160} />
        <T size="xxl" weight="heavy" color={colors.greenDark} style={{ marginTop: 8 }}>청개구리</T>
        <T size="sm" color={colors.muted}>비가 오면, 혜택이 쏟아진다.</T>
      </Animated.View>
    </View>
  );
}
