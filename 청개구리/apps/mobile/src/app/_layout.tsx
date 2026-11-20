import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '@/lib/app-state';
import { colors } from '@cheong/design-tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: colors.forest,
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: '로그인', presentation: 'modal' }} />
          <Stack.Screen name="signup" options={{ title: '회원가입', presentation: 'modal' }} />
          <Stack.Screen name="store/[id]" options={{ title: '' }} />
          <Stack.Screen name="reserve/[storeId]" options={{ title: '예약하기' }} />
          <Stack.Screen name="reservation/[id]" options={{ title: '예약 정보' }} />
          <Stack.Screen name="typhoon" options={{ title: '개굴이의 태풍 특가' }} />
          <Stack.Screen name="region" options={{ title: '지역 선택', presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ title: '알림' }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
