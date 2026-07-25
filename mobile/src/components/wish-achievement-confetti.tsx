import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/colors';

const PIECES = [
  { left: '8%', delay: 0, color: colors.accent, size: 10, rotate: 18 },
  { left: '18%', delay: 120, color: colors.danger, size: 8, rotate: -24 },
  { left: '28%', delay: 40, color: '#7BC67E', size: 12, rotate: 40 },
  { left: '38%', delay: 200, color: '#F5A524', size: 9, rotate: -12 },
  { left: '48%', delay: 80, color: colors.accent, size: 11, rotate: 30 },
  { left: '58%', delay: 160, color: colors.danger, size: 8, rotate: -36 },
  { left: '68%', delay: 60, color: '#7BC67E', size: 10, rotate: 16 },
  { left: '78%', delay: 220, color: '#F5A524', size: 12, rotate: -20 },
  { left: '88%', delay: 100, color: colors.accent, size: 9, rotate: 28 },
  { left: '14%', delay: 260, color: '#F5A524', size: 7, rotate: -8 },
  { left: '72%', delay: 180, color: colors.danger, size: 11, rotate: 22 },
  { left: '42%', delay: 300, color: '#7BC67E', size: 8, rotate: -30 },
] as const;

function ConfettiPiece({
  left,
  delay,
  color,
  size,
  rotate,
}: (typeof PIECES)[number]) {
  const progress = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }),
        2,
        false,
      ),
    );
    spin.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.linear }),
        2,
        false,
      ),
    );
  }, [delay, progress, spin]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value * 0.35,
    transform: [
      { translateY: -20 + progress.value * 220 },
      { translateX: (progress.value - 0.5) * 24 },
      { rotate: `${rotate + spin.value * 180}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 24,
          left,
          width: size,
          height: size * 0.55,
          borderRadius: 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function WishAchievementConfetti({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {PIECES.map((piece) => (
        <ConfettiPiece key={`${piece.left}-${piece.delay}`} {...piece} />
      ))}
    </View>
  );
}
