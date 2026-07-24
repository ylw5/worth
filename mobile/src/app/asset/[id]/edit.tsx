import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Stack,
  router,
  useLocalSearchParams,
  useNavigation,
} from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';

import { AssetFormFields } from '@/components/asset-form-fields';
import { AssetPhotoPicker } from '@/components/asset-photo-picker';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { analyzePhotos, estimateAsset } from '@/lib/api';
import {
  getAsset,
  removePhotos,
  recordValuation,
  updateAsset,
  uploadPhotos,
} from '@/lib/assets';
import { specsToText, textToSpecs } from '@/lib/format';
import type { AssetPhoto } from '@/lib/photos';
import { parsePurchaseInput } from '@/lib/purchase-input';
import { tryValuation } from '@/lib/try-valuation';
import type { Asset, AssetInput } from '@/types/domain';

function AssetEditForm({ asset }: { asset: Asset }) {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const originalPaths = asset.photo_paths;
  const stagedPaths = useRef(new Set<string>());
  const [photos, setPhotos] = useState<AssetPhoto[]>(
    asset.photo_paths.map((path, index) => ({
      id: path,
      path,
      uri: asset.photo_urls?.[index] ?? '',
      analysisUrl: asset.photo_urls?.[index],
    })),
  );
  const [form, setForm] = useState<AssetInput>({
    name: asset.name,
    brand: asset.brand,
    model: asset.model,
    specs: asset.specs,
    category: asset.category,
    condition: asset.condition,
    search_query: asset.search_query,
    purchase_date: asset.purchase_date ?? '',
    purchase_price: asset.purchase_price?.toString() ?? '',
  });
  const [specsText, setSpecsText] = useState(specsToText(asset.specs));
  const [reviewed, setReviewed] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'reanalyze' | 'save' | null
  >(null);
  const [error, setError] = useState('');
  const loading = pendingAction !== null;
  const photosChanged =
    photos.length !== originalPaths.length ||
    photos.some((photo, index) => photo.path !== originalPaths[index]);

  useEffect(() => {
    if (!loading) return;
    return navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
    });
  }, [loading, navigation]);

  useEffect(
    () => () => {
      const paths = [...stagedPaths.current];
      if (paths.length) removePhotos(paths).catch(() => undefined);
    },
    [],
  );

  const refreshQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['asset', asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['valuations', asset.id] }),
      queryClient.invalidateQueries({ queryKey: ['assets'] }),
    ]);

  const changePhotos = (next: AssetPhoto[]) => {
    setPhotos(next);
    setReviewed(false);
  };

  const preparePhotos = async (current: AssetPhoto[]) => {
    const pending = current.filter((photo) => !photo.path);
    if (!pending.length) return current;
    const uploaded = await uploadPhotos(
      pending.map((photo) => photo.base64 ?? ''),
      asset.user_id,
    );
    const byId = new Map(
      pending.map((photo, index) => [photo.id, uploaded[index]]),
    );
    const prepared = current.map((photo) => {
      const upload = byId.get(photo.id);
      if (!upload) return photo;
      stagedPaths.current.add(upload.path);
      return {
        ...photo,
        path: upload.path,
        analysisUrl: upload.signedUrl,
      };
    });
    setPhotos(prepared);
    return prepared;
  };

  const previewRecognition = async () => {
    setPendingAction('reanalyze');
    setError('');
    try {
      const prepared = await preparePhotos(photos);
      const recognition = await analyzePhotos(
        prepared.map((photo) => photo.analysisUrl ?? photo.uri),
      );
      setForm((current) => ({
        ...recognition,
        purchase_date: current.purchase_date,
        purchase_price: current.purchase_price,
      }));
      setSpecsText(specsToText(recognition.specs));
      setReviewed(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重新解析失败');
    } finally {
      setPendingAction(null);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.search_query.trim()) {
      setError('请填写名称和估价搜索词');
      return;
    }
    const purchase = parsePurchaseInput(
      form.purchase_date,
      form.purchase_price,
    );
    if ('error' in purchase) {
      setError(purchase.error);
      return;
    }

    setPendingAction('save');
    setError('');
    const input = {
      ...form,
      ...purchase.input,
      specs: textToSpecs(specsText),
    };
    let prepared = photos;
    try {
      prepared = await preparePhotos(photos);
      await updateAsset(
        asset.id,
        input,
        prepared.map((photo) => photo.path as string),
      );
    } catch (caught) {
      const staged = [...stagedPaths.current];
      await removePhotos(staged).catch(() => undefined);
      stagedPaths.current.clear();
      setPhotos(
        prepared.map((photo) =>
          photo.path && staged.includes(photo.path)
            ? { ...photo, path: undefined, analysisUrl: undefined }
            : photo,
        ),
      );
      setError(caught instanceof Error ? caught.message : '保存失败');
      setPendingAction(null);
      return;
    }

    const savedPaths = prepared.map((photo) => photo.path as string);
    const unusedStaged = [...stagedPaths.current].filter(
      (path) => !savedPaths.includes(path),
    );
    const removedPaths = originalPaths.filter(
      (path) => !savedPaths.includes(path),
    );
    stagedPaths.current.clear();
    await removePhotos([...unusedStaged, ...removedPaths]).catch(
      () => undefined,
    );

    const valuationUpdated = await tryValuation(async () => {
      const valuation = await estimateAsset(input);
      await recordValuation(asset.id, valuation);
    });
    await refreshQueries();
    setPendingAction(null);

    if (!valuationUpdated) {
      setError('信息已保存，估价失败，可稍后刷新价格');
      return;
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
        <AssetPhotoPicker
          photos={photos}
          onChange={changePhotos}
          onError={setError}
        />
        {photosChanged ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={previewRecognition}
            style={({ pressed }) => ({
              alignItems: 'center',
              minHeight: 48,
              justifyContent: 'center',
              padding: spacing.lg,
              borderRadius: radius.medium,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: pressed || loading ? 0.65 : 1,
            })}>
            {pendingAction === 'reanalyze' ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text
                style={{
                  ...typography.body,
                  color: colors.textPrimary,
                  fontWeight: '700',
                }}>
                重新解析照片
              </Text>
            )}
          </Pressable>
        ) : null}
        <AssetFormFields
          form={form}
          specsText={specsText}
          onChange={setForm}
          onChangeSpecsText={setSpecsText}
        />
        {error ? (
          <Text selectable style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        {reviewed ? (
          <Text selectable style={{ color: colors.accent, ...typography.body }}>
            解析完成，请确认信息后保存
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={save}
          style={({ pressed }) => ({
            alignItems: 'center',
            minHeight: 52,
            justifyContent: 'center',
            padding: spacing.lg,
            borderRadius: radius.medium,
            borderCurve: 'continuous',
            backgroundColor: colors.textPrimary,
            opacity: pressed || loading ? 0.65 : 1,
          })}>
          {pendingAction === 'save' ? (
            <ActivityIndicator color={colors.onDark} />
          ) : (
            <Text
              style={{
                color: colors.onDark,
                ...typography.body,
                fontWeight: '700',
              }}>
              保存并重新估价
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function AssetEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => getAsset(id),
    enabled: Boolean(id),
  });

  if (assetQuery.isLoading) return <LoadingState />;
  if (assetQuery.error) return <ErrorState message={assetQuery.error.message} />;
  if (!assetQuery.data) return <ErrorState message="资产不存在" />;

  return (
    <>
      <Stack.Screen options={{ title: '编辑物品' }} />
      <AssetEditForm asset={assetQuery.data} />
    </>
  );
}
