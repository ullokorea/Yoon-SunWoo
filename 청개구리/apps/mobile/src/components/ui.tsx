import { colors, font, frogShapes, modeTheme, POSE_LABEL, radius, space, touch, type FrogPose, type WeatherModeKey } from '@cheong/design-tokens';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

export { colors };

// ---------------- 개굴이 ----------------

export function Frog({ pose, size = 120, animated = true }: { pose: FrogPose; size?: number; animated?: boolean }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated || (pose !== 'jumping' && pose !== 'cheering')) return;
    // 가벼운 위아래 움직임만 (네이티브 드라이버 — JS 스레드 부담 없음)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: -6, duration: 520, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pose, y]);

  return (
    <Animated.View style={{ transform: [{ translateY: y }] }} accessible accessibilityRole="image" accessibilityLabel={POSE_LABEL[pose]}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        {frogShapes(pose).map((s, i) => {
          switch (s.t) {
            case 'ellipse':
              return <Ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} opacity={s.opacity} />;
            case 'circle':
              return <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} opacity={s.opacity} />;
            case 'rect':
              return <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} fill={s.fill} />;
            case 'path':
              return (
                <Path key={i} d={s.d} fill={s.fill ?? 'none'} stroke={s.stroke} strokeWidth={s.sw} strokeLinecap="round" strokeLinejoin="round" opacity={s.opacity} />
              );
          }
        })}
      </Svg>
    </Animated.View>
  );
}

export const MODE_POSE: Record<string, FrogPose> = {
  CLEAR: 'resting',
  RAIN_FORECAST: 'preparing',
  RAINING: 'jumping',
  TYPHOON_WATCH: 'sheltering',
  DANGER: 'sheltering',
  RECOVERY: 'cheering',
  UNKNOWN: 'thinking',
};
export const themeOf = (mode: string) => modeTheme[(mode as WeatherModeKey) in modeTheme ? (mode as WeatherModeKey) : 'UNKNOWN'];

// ---------------- 기본 요소 ----------------

export function Screen({ children, style, edges = ['top'] }: { children: ReactNode; style?: StyleProp<ViewStyle>; edges?: Array<'top' | 'bottom'> }) {
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function T({ children, style, size = 'md', weight = 'regular', color = colors.forest, numberOfLines }: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  size?: keyof typeof font.size;
  weight?: keyof typeof font.weight;
  color?: string;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontSize: font.size[size], fontWeight: font.weight[weight], color, lineHeight: font.size[size] * 1.4 }, style]}>
      {children}
    </Text>
  );
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'sun' | 'danger';
const BTN: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.green, fg: colors.white },
  secondary: { bg: colors.mint, fg: colors.forest },
  ghost: { bg: colors.white, fg: colors.forest, border: colors.line },
  sun: { bg: colors.yellow, fg: colors.forest },
  danger: { bg: colors.dangerBg, fg: colors.danger },
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, style, small }: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const v = BTN[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: small ? 40 : 52,
          paddingHorizontal: small ? space.md : space.lg,
          borderRadius: radius.md,
          backgroundColor: v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <T weight="bold" size={small ? 'sm' : 'md'} color={v.fg}>{title}</T>}
    </Pressable>
  );
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  const s = [styles.card, style];
  if (!onPress) return <View style={s}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [...s, pressed && { opacity: 0.9 }]}>
      {children}
    </Pressable>
  );
}

export function Badge({ text, bg = colors.surface, fg = colors.muted, center }: { text: string; bg?: string; fg?: string; center?: boolean }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: center ? 'center' : 'flex-start' }}>
      <T size="xs" weight="bold" color={fg}>{text}</T>
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={{
        minHeight: touch.min - 4,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? colors.green : colors.line,
        backgroundColor: active ? colors.mint : colors.white,
        justifyContent: 'center',
      }}
    >
      <T size="sm" weight="bold" color={active ? colors.greenDark : colors.muted}>{label}</T>
    </Pressable>
  );
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <View style={{ padding: 40, alignItems: 'center', gap: 8 }} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.green} />
      <T size="sm" color={colors.muted}>{label}</T>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ padding: 24, alignItems: 'center', gap: 10 }} accessibilityRole="alert">
      <Frog pose="thinking" size={90} animated={false} />
      <T weight="bold" style={{ textAlign: 'center' }}>{message}</T>
      {onRetry && <Button title="다시 시도" variant="ghost" small onPress={onRetry} />}
    </View>
  );
}

export function Empty({ title, sub, pose = 'resting', action }: { title: string; sub?: string; pose?: FrogPose; action?: ReactNode }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
      <Frog pose={pose} size={100} />
      <T weight="bold" style={{ textAlign: 'center' }}>{title}</T>
      {sub && <T size="sm" color={colors.muted} style={{ textAlign: 'center' }}>{sub}</T>}
      {action}
    </View>
  );
}

export function DiscountTag({ rate, kind }: { rate: number; kind?: string }) {
  const typhoon = kind && kind !== 'RAIN';
  return (
    <View style={{ backgroundColor: typhoon ? colors.typhoon : colors.yellow, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <T size="sm" weight="heavy" color={typhoon ? colors.white : colors.forest}>{rate}%</T>
    </View>
  );
}

/** 개발 모드 표시: Mock 데이터가 실제처럼 보이지 않도록 */
export function MockNotice({ text }: { text: string }) {
  return (
    <View style={{ backgroundColor: '#FFF0E0', paddingVertical: 5, paddingHorizontal: 12 }}>
      <T size="xs" weight="bold" color={colors.mock} style={{ textAlign: 'center' }}>{text}</T>
    </View>
  );
}

const CATEGORY_EMOJI: Record<string, string> = { KOREAN: '🍲', CAFE: '☕', WESTERN: '🍝', JAPANESE: '🍣', CHINESE: '🥟', BAR: '🍶', BAKERY: '🥐', ETC: '🍽️' };

/** 매장 대표 이미지 (사진이 없으면 카테고리 일러스트) */
export function StoreThumb({ category, size = 76 }: { category: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.45 }}>{CATEGORY_EMOJI[category] ?? '🍽️'}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  pad: { paddingHorizontal: space.lg },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.forest,
    backgroundColor: colors.white,
  },
});
