import { useMutation, useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { WishAchievementCard } from '@/components/wish-achievement-card';
import { WishAchievementConfetti } from '@/components/wish-achievement-confetti';
import { colors, spacing, typography } from '@/constants/colors';
import {
  requestWishAchievementSavePermission,
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
      const permission = await requestWishAchievementSavePermission();
      if (permission === 'denied') {
        throw new Error('需要相册权限才能保存，请在设置中开启');
      }
      setCapturing(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await saveWishAchievementImage(uri);
    },
    onSuccess: () => {
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
          backgroundColor: colors.surface,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}>
        <View
          style={{
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭"
            hitSlop={8}
            onPress={close}
            style={{
              width: 44,
              height: 44,
              alignItems: 'flex-start',
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
        </View>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {!query.isLoading && !query.error && !fulfilled ? (
          <ErrorState message="该心愿尚未实现，无法展示成就" />
        ) : null}

        {fulfilled && item ? (
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: spacing.xl,
            }}>
            <View style={{ position: 'relative' }}>
              {!capturing ? <WishAchievementConfetti active /> : null}
              <View ref={cardRef} collapsable={false}>
                <WishAchievementCard
                  name={item.name}
                  actualPrice={item.actual_price!}
                  fulfilledAt={item.fulfilled_at!}
                />
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="保存图片"
              disabled={saveMutation.isPending || capturing}
              onPress={() => saveMutation.mutate()}
              style={({ pressed }) => ({
                marginTop: spacing.xxxl,
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
        ) : null}
      </View>
    </>
  );
}
