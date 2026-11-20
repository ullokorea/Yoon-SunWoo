import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { colors } from '@cheong/design-tokens';

const icon = (emoji: string) => ({ focused }: { focused: boolean }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.greenDark,
        tabBarInactiveTintColor: colors.subtle,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: { borderTopColor: colors.line, minHeight: 56 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: icon('🐸') }} />
      <Tabs.Screen name="explore" options={{ title: '탐색', tabBarIcon: icon('🔍') }} />
      <Tabs.Screen name="reservations" options={{ title: '예약', tabBarIcon: icon('🎫') }} />
      <Tabs.Screen name="favorites" options={{ title: '즐겨찾기', tabBarIcon: icon('💚') }} />
      <Tabs.Screen name="my" options={{ title: '마이', tabBarIcon: icon('👤') }} />
    </Tabs>
  );
}
