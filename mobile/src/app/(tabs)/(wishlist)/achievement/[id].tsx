import { useMutation, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { TarotTransformation } from '@/components/tarot-transformation';
import { colors, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import {
  saveWishAchievementImage,
  wishAchievementSaveErrorMessage,
} from '@/lib/wish-achievement-save';
import { getWishlistItem } from '@/lib/wishlist';

export default function WishAchievementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);
  const [capturing, setCapturing] = useState(false);

  const query = useQuery({
    queryKey: ['wishlist', id],
    queryFn: () => getWishlistItem(id),
    enabled: Boolean(id),
  });

  const item = query.data;
  const fulfilled =
    !!item && item.actual_price !== null && item.fulfilled_at !== null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      setCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      return saveWishAchievementImage(uri);
    },
    onSuccess: (result) => {
      if (result === 'shared') {
        Alert.alert('已打开分享', '当前环境无法直接写入相册，请通过分享保存图片');
        return;
      }
      Alert.alert('已保存', '已保存到相册，可去微信等应用分享');
    },
    onError: (error) => {
      Alert.alert('保存失败', wishAchievementSaveErrorMessage(error));
    },
    onSettled: () => {
      setCapturing(false);
    },
  });

  const close = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/(wishlist)');
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={{
          flex: 1,
          backgroundColor: '#FFFDF8',
          paddingBottom: insets.bottom,
        }}>
        <LinearGradient
          colors={['#FFFDF8', '#F7F1E6', '#FFFCF5']}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭"
          hitSlop={8}
          onPress={close}
          style={{
            position: 'absolute',
            top: insets.top,
            left: spacing.lg,
            zIndex: 2,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 28,
              fontWeight: '400',
              lineHeight: 32,
            }}>
            ×
          </Text>
        </Pressable>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {!query.isLoading && !query.error && !fulfilled ? (
          <ErrorState message="该心愿尚未实现，无法展示成就" />
        ) : null}

        {fulfilled && item ? (
          <View style={{ flex: 1, overflow: 'visible' }}>
            <View
              ref={cardRef}
              collapsable={false}
              style={{ flex: 1, overflow: 'hidden' }}>
              <TarotTransformation
                data={{
                  wish: item.name,
                  valueConversion: formatCurrency(item.actual_price!),
                  wealthFlow: '逆位 → 正位',
                }}
              />
            </View>

            <View
              style={{
                minHeight: 72,
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: spacing.sm,
                paddingBottom: spacing.xl,
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="保存图片"
                disabled={saveMutation.isPending || capturing}
                onPress={() => saveMutation.mutate()}
                style={({ pressed }) => ({
                  alignSelf: 'center',
                  minWidth: 200,
                  minHeight: 52,
                  paddingHorizontal: spacing.xxxl,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  backgroundColor: colors.textPrimary,
                  opacity:
                    pressed || saveMutation.isPending || capturing ? 0.65 : 1,
                })}>
                {saveMutation.isPending || capturing ? (
                  <ActivityIndicator color={colors.onDark} />
                ) : (
                  <Text
                    style={{
                      color: colors.onDark,
                      ...typography.cardTitle,
                      fontWeight: '700',
                    }}>
                    保存图片
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </>
  );
}
