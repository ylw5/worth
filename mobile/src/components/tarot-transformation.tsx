import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TarotDynamicData = {
  wish: string;
  valueConversion: string;
  wealthFlow: string;
};

type TarotTransformationProps = {
  reversedCardSource?: number;
  uprightCardSource?: number;
  data: TarotDynamicData;
  onRevealed?: () => void;
};

const reversedCard = require('../../assets/tarot/reversed-card.svg');
const uprightCard = require('../../assets/tarot/upright-card.svg');

const gold = '#A88350';
const goldDeep = '#8B6A38';
const ink = '#253149';
const warmWhite = '#FFFDF7';

export function TarotTransformation({
  reversedCardSource = reversedCard,
  uprightCardSource = uprightCard,
  data,
  onRevealed,
}: TarotTransformationProps) {
  const insets = useSafeAreaInsets();
  const [revealed, setRevealed] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flip = useSharedValue(0);
  const shimmer = useSharedValue(0);
  const reveal = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600 }),
        withTiming(0, { duration: 1600 })
      ),
      -1,
      true
    );
  }, [shimmer]);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  const handleReveal = () => {
    if (revealed) return;

    flip.value = withTiming(1, { duration: 1180 });
    reveal.value = withDelay(720, withTiming(1, { duration: 760 }));

    revealTimer.current = setTimeout(() => {
      setRevealed(true);
      onRevealed?.();
    }, 1180);
  };

  const cardMotionStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flip.value, [0, 1], [0, 360], Extrapolation.CLAMP);
    const rotateZ = interpolate(flip.value, [0, 1], [180, 0], Extrapolation.CLAMP);
    const scale = interpolate(flip.value, [0, 1], [0.88, 1], Extrapolation.CLAMP);
    const translateY = interpolate(flip.value, [0, 1], [8, -8], Extrapolation.CLAMP);

    return {
      transform: [
        { perspective: 1200 },
        { translateY },
        { rotateY: `${rotateY}deg` },
        { rotateZ: `${rotateZ}deg` },
        { scale },
      ],
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(shimmer.value, [0, 1], [0.18, 0.42], Extrapolation.CLAMP);
    const scale = interpolate(shimmer.value, [0, 1], [0.96, 1.05], Extrapolation.CLAMP);

    return {
      opacity: revealed ? 0.2 : opacity,
      transform: [{ scale }],
    };
  });

  const lightSweepStyle = useAnimatedStyle(() => {
    const translateX = interpolate(flip.value, [0, 1], [-180, 180], Extrapolation.CLAMP);
    const opacity = interpolate(flip.value, [0, 0.2, 0.7, 1], [0, 0.24, 0.18, 0], Extrapolation.CLAMP);

    return {
      opacity,
      transform: [{ translateX }, { rotate: '18deg' }],
    };
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(flip.value, [0, 0.2, 0.62, 1], [0, 0.75, 0.45, 0], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(flip.value, [0, 0.5, 1], [0.72, 1, 0.9], Extrapolation.CLAMP) },
    ],
  }));

  const dataLayerStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [
      { translateY: interpolate(reveal.value, [0, 1], [8, 0], Extrapolation.CLAMP) },
    ],
  }));

  const flipHintStyle = useAnimatedStyle(() => ({
    height: interpolate(flip.value, [0, 0.35, 1], [24, 0, 0], Extrapolation.CLAMP),
    marginTop: interpolate(flip.value, [0, 0.35, 1], [4, -12, -12], Extrapolation.CLAMP),
    opacity: interpolate(flip.value, [0, 0.22, 1], [1, 0, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(flip.value, [0, 0.35, 1], [0, -4, -4], Extrapolation.CLAMP) },
    ],
  }));

  const quoteStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [
      { translateY: interpolate(reveal.value, [0, 1], [22, 0], Extrapolation.CLAMP) },
    ],
  }));

  const closeRowHeight = 44;
  const topChrome = Math.max(insets.top, 12) + closeRowHeight;

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#FFFDF8', '#F7F1E6', '#FFFCF5']}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.contentStage, { paddingTop: topChrome }]}>
        <View style={styles.experienceContent}>
        <View style={styles.cardStage}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? '星币六已转为正位' : '将星币六从逆位转为正位'}
            disabled={revealed}
            onPress={handleReveal}
            style={({ pressed }) => [styles.pressTarget, pressed && !revealed ? styles.pressed : null]}>
            <Animated.View style={[styles.cardWrap, cardMotionStyle]}>
              <Image
                contentFit="contain"
                source={revealed ? uprightCardSource : reversedCardSource}
                style={styles.cardImage}
              />
              <Animated.View pointerEvents="none" style={[styles.lightSweep, lightSweepStyle]} />
              <Animated.View pointerEvents="none" style={[styles.sparkleField, sparkleStyle]}>
                <Text style={[styles.sparkle, styles.sparkleTop]}>✦</Text>
                <Text style={[styles.sparkle, styles.sparkleRight]}>✧</Text>
                <Text style={[styles.sparkle, styles.sparkleBottom]}>✦</Text>
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.dynamicLayer, dataLayerStyle]}>
                <DynamicTarotFace data={data} />
              </Animated.View>
            </Animated.View>
          </Pressable>
        </View>

        <Animated.View pointerEvents="none" style={[styles.flipHint, flipHintStyle]}>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            numberOfLines={1}
            style={styles.flipHintText}>
            点击翻转 逆位 Six of Pentacles · 星币六
          </Text>
        </Animated.View>

        <Animated.View style={[styles.quoteSection, quoteStyle]}>
          <Text style={styles.quoteTitle}>Six of Pentacles · 星币六</Text>
          <View style={styles.rule} />
          <Text style={styles.quoteBody}>星币六象征财富、资源与价值的流动。</Text>
          <View style={styles.meaningBlock}>
            <Text style={styles.meaningText}>
              <Text style={styles.meaningEmphasis}>逆位，代表资源失衡、过度给予与无序支出。</Text>
            </Text>
            <Text style={styles.meaningText}>
              <Text style={styles.meaningEmphasis}>正位，代表财富平衡、收获回馈与良性流动。</Text>
            </Text>
          </View>
          <Text style={styles.closing}>愿每一份积累，都通向你的心愿。</Text>
        </Animated.View>
        </View>
      </View>
    </View>
  );
}

function DynamicTarotFace({ data }: { data: TarotDynamicData }) {
  return (
    <View style={styles.faceTextLayer}>
      <TarotFactRow label="愿望" placement="wish" value={data.wish} />
      <TarotFactRow label="价值转换" placement="amount" value={data.valueConversion} />
      <TarotFactRow label="财富流向" placement="flow" value={data.wealthFlow} />
    </View>
  );
}

function TarotFactRow({
  label,
  placement,
  value,
}: {
  label: string;
  placement: 'wish' | 'amount' | 'flow';
  value: string;
}) {
  return (
    <View style={[styles.factRow, styles[`${placement}Row`]]}>
      <Text numberOfLines={1} style={[styles.tarotRowText, styles.factLabel]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.58}
        style={[styles.tarotRowText, styles.factValue]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: warmWhite,
  },
  contentStage: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  experienceContent: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
  },
  cardStage: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 286,
    height: 286,
    borderRadius: 143,
    borderWidth: 1,
    borderColor: 'rgba(168, 131, 80, 0.24)',
    backgroundColor: 'rgba(217, 189, 134, 0.14)',
    shadowColor: gold,
    shadowOpacity: 0.35,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 0 },
  },
  pressTarget: {
    borderRadius: 28,
  },
  pressed: {
    opacity: 0.96,
  },
  cardWrap: {
    width: 270,
    aspectRatio: 767.25 / 1152.75,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 26,
    shadowColor: '#4E3C20',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  lightSweep: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    width: 62,
    backgroundColor: 'rgba(255, 246, 215, 0.72)',
  },
  sparkleField: {
    ...StyleSheet.absoluteFill,
  },
  sparkle: {
    position: 'absolute',
    color: '#C6A568',
    fontSize: 18,
    textShadowColor: 'rgba(198, 165, 104, 0.38)',
    textShadowRadius: 10,
  },
  sparkleTop: {
    top: '18%',
    right: '22%',
  },
  sparkleRight: {
    top: '44%',
    right: '12%',
    fontSize: 14,
  },
  sparkleBottom: {
    bottom: '23%',
    left: '18%',
    fontSize: 16,
  },
  dynamicLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  faceTextLayer: {
    flex: 1,
  },
  factRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  wishRow: {
    top: '69.5%',
    height: '6.05%',
  },
  amountRow: {
    top: '75.55%',
    height: '5.78%',
  },
  flowRow: {
    top: '81.33%',
    height: '7.65%',
  },
  tarotRowText: {
    color: ink,
    fontFamily: Platform.select({
      ios: 'Kaiti SC',
      macos: 'Kaiti SC',
      web: '"Kaiti SC", "STKaiti", "KaiTi", serif',
      default: 'serif',
    }),
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0,
  },
  factLabel: {
    position: 'absolute',
    left: '29.8%',
    width: '21%',
    textAlign: 'left',
  },
  factValue: {
    position: 'absolute',
    left: '52%',
    right: '20%',
    textAlign: 'right',
  },
  flipHint: {
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipHintText: {
    color: '#8B744F',
    fontFamily: 'Georgia',
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
    textAlign: 'center',
  },
  quoteSection: {
    width: '100%',
    maxWidth: 340,
    gap: 10,
    paddingTop: 4,
  },
  quoteTitle: {
    color: goldDeep,
    fontFamily: 'Georgia',
    fontSize: 21,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  rule: {
    alignSelf: 'center',
    width: 96,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(139, 106, 56, 0.5)',
  },
  quoteBody: {
    color: ink,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontWeight: '400',
  },
  meaningBlock: {
    gap: 6,
    paddingTop: 2,
  },
  meaningText: {
    color: '#5F687A',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  meaningEmphasis: {
    fontStyle: 'italic',
  },
  closing: {
    marginTop: 6,
    color: ink,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '700',
  },
});
