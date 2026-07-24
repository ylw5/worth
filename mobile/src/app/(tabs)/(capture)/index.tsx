import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';

import { AssetPhotoPicker } from '@/components/asset-photo-picker';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { analyzePhotos } from '@/lib/api';
import { removePhotos, uploadPhotos } from '@/lib/assets';
import type { AssetPhoto } from '@/lib/photos';
import { useDraft } from '@/providers/draft-provider';
import { useSession } from '@/providers/session-provider';

export default function CaptureScreen() {
  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { session } = useSession();
  const { setDraft } = useDraft();

  const analyze = async () => {
    if (!session || !photos.length) {
      setError('请至少添加一张照片');
      return;
    }
    setLoading(true);
    setError('');
    let uploadedPaths: string[] = [];
    try {
      const uploaded = await uploadPhotos(
        photos.map((photo) => photo.base64 ?? ''),
        session.user.id,
      );
      uploadedPaths = uploaded.map((photo) => photo.path);
      const recognition = await analyzePhotos(
        uploaded.map((photo) => photo.signedUrl),
      );
      setDraft({
        localUris: photos.map((photo) => photo.uri),
        photoPaths: uploadedPaths,
        recognition,
      });
      setPhotos([]);
      router.push('/confirm');
    } catch (caught) {
      await removePhotos(uploadedPaths).catch(() => undefined);
      setError(
        caught instanceof Error ? caught.message : '识别失败，请重新拍摄',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '录入物品', headerShown: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
        <Text
          selectable
          style={{ color: colors.textSecondary, ...typography.body }}>
          添加同一件物品的正面、背面、铭牌或细节照片
        </Text>
        <AssetPhotoPicker
          photos={photos}
          onChange={setPhotos}
          onError={setError}
        />
        {error ? (
          <Text selectable style={{ color: colors.danger, ...typography.body }}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={loading || !photos.length}
          onPress={analyze}
          style={({ pressed }) => ({
            alignItems: 'center',
            minHeight: 52,
            justifyContent: 'center',
            padding: spacing.lg,
            borderRadius: radius.medium,
            borderCurve: 'continuous',
            backgroundColor: colors.textPrimary,
            opacity: pressed || loading || !photos.length ? 0.65 : 1,
          })}>
          {loading ? (
            <ActivityIndicator color={colors.onDark} />
          ) : (
            <Text
              style={{
                color: colors.onDark,
                ...typography.body,
                fontWeight: '700',
              }}>
              解析照片
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </>
  );
}
