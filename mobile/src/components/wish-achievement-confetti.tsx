import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const COLORS = [
  '#78B4FF',
  '#C9362B',
  '#7BC67E',
  '#F5A524',
  '#FF6B9D',
  '#9B7EDE',
  '#FFD166',
] as const;

type Piece = {
  id: number;
  color: string;
  size: number;
  angle: number;
  distance: number;
  delay: number;
  shape: 'rect' | 'dot';
};

const PIECES: Piece[] = Array.from({ length: 36 }, (_, id) => {
  const angle = (id / 36) * Math.PI * 2 + (id % 3) * 0.18;
  return {
    id,
    color: COLORS[id % COLORS.length],
    size: 8 + (id % 5) * 2,
    angle,
    distance: 90 + (id % 6) * 28,
    delay: (id % 8) * 40,
    shape: id % 3 === 0 ? 'dot' : 'rect',
  };
});

function FireworkPiece({
  color,
  size,
  angle,
  distance,
  delay,
  shape,
}: Piece) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withSequence(
        withTiming(1, {
          duration: 900,
          easing: Easing.out(Easing.cubic),
        }),
        withTiming(1.35, {
          duration: 700,
          easing: Easing.in(Easing.quad),
        }),
      ),
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => {
    const burst = Math.min(progress.value, 1);
    const fall = Math.max(progress.value - 1, 0);
    const radius = distance * burst;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius + fall * 120;
    const opacity =
      progress.value < 0.08 ? progress.value / 0.08 : 1 - fall * 1.4;

    return {
      opacity: Math.max(0, Math.min(1, opacity)),
      transform: [
        { translateX: x - size / 2 },
        { translateY: y - size / 2 },
        { rotate: `${angle + progress.value * 220}deg` },
        { scale: 0.7 + burst * 0.5 },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          top: 0,
          width: size,
          height: shape === 'dot' ? size : size * 0.45,
          borderRadius: shape === 'dot' ? size / 2 : 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/** Burst origin is the center of the parent (place over the ring). */
export function WishAchievementConfetti({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={styles.origin}>
        {PIECES.map((piece) => (
          <FireworkPiece key={piece.id} {...piece} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  origin: {
    width: 0,
    height: 0,
    overflow: 'visible',
  },
});
