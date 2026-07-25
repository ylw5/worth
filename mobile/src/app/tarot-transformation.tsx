import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { TarotTransformation } from '@/components/tarot-transformation';
import { radius, spacing, typography } from '@/constants/colors';
import {
  saveWishAchievementImage,
  wishAchievementSaveErrorMessage,
} from '@/lib/wish-achievement-save';

export default function TarotTransformationScreen() {
  const [revealed, setRevealed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const previewRef = useRef<View>(null);

  const savePreview = async () => {
    try {
      setCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const uri = await captureRef(previewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await saveWishAchievementImage(uri);
      Alert.alert('已保存', '塔罗分享图已生成');
    } catch (error) {
      Alert.alert('保存失败', wishAchievementSaveErrorMessage(error));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFCF5' }}>
      <View ref={previewRef} collapsable={false} style={{ flex: 1, overflow: 'hidden' }}>
        <TarotTransformation
          data={{
            wish: '演唱会门票',
            valueConversion: '¥1,880',
            wealthFlow: '逆位 → 正位',
          }}
          onRevealed={() => setRevealed(true)}
        />
      </View>
      <View
        style={{
          minHeight: 72,
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: spacing.sm,
          paddingBottom: spacing.lg,
          backgroundColor: '#FFFCF5',
        }}>
        {revealed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存图片"
            disabled={capturing}
            onPress={() => void savePreview()}
            style={({ pressed }) => ({
              minWidth: 200,
              minHeight: 52,
              paddingHorizontal: spacing.xxxl,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: 'rgba(168, 131, 80, 0.36)',
              backgroundColor: '#EADDBF',
              opacity: pressed || capturing ? 0.65 : 1,
            })}>
            {capturing ? (
              <ActivityIndicator color="#765D38" />
            ) : (
              <Text
                style={{
                  color: '#765D38',
                  ...typography.cardTitle,
                  fontFamily: Platform.select({
                    ios: 'Kaiti SC',
                    macos: 'Kaiti SC',
                    web: '"Kaiti SC", "STKaiti", "KaiTi", serif',
                    default: 'serif',
                  }),
                  fontWeight: '600',
                  letterSpacing: 0,
                }}>
                保存图片
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
