import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import {
  router,
  Stack,
  useLocalSearchParams,
  useNavigation,
} from 'expo-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';

import { AssetFormFields } from '@/components/asset-form-fields';
import { AssetPhotoPicker } from '@/components/asset-photo-picker';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { analyzePhotos, cutoutPhoto, estimateAsset } from '@/lib/api';
import {
  createAsset,
  recordValuation,
  removePhotos,
  uploadCover,
  uploadPhoto,
} from '@/lib/assets';
import { specsToText, textToSpecs } from '@/lib/format';
import {
  mergeRecognition,
  type ProtectedField,
} from '@/lib/incremental-import';
import {
  pickerAssetsToPhotos,
  type AssetPhoto,
} from '@/lib/photos';
import { parsePurchaseInput } from '@/lib/purchase-input';
import { useSession } from '@/providers/session-provider';
import type { AssetInput } from '@/types/domain';

const emptyForm: AssetInput = {
  name: '',
  brand: '',
  model: '',
  specs: {},
  category: '其他',
  condition: '无法判断',
  search_query: '',
  purchase_date: '',
  purchase_price: '',
};

const recognizedFields: ProtectedField[] = [
  'name',
  'brand',
  'model',
  'specs',
  'category',
  'condition',
  'search_query',
];

export default function CaptureScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { camera } = useLocalSearchParams<{ camera?: string }>();
  const { session } = useSession();
  const [photos, setPhotoState] = useState<AssetPhoto[]>([]);
  const photosRef = useRef<AssetPhoto[]>([]);
  const [form, setFormState] = useState(emptyForm);
  const formRef = useRef(emptyForm);
  const protectedFields = useRef(new Set<ProtectedField>());
  const [specsText, setSpecsText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saved = useRef(false);
  const openedInitialCamera = useRef(false);

  const setPhotos = (
    update:
      | AssetPhoto[]
      | ((current: AssetPhoto[]) => AssetPhoto[]),
  ) => {
    const next =
      typeof update === 'function' ? update(photosRef.current) : update;
    photosRef.current = next;
    setPhotoState(next);
  };

  const setForm = (next: AssetInput) => {
    formRef.current = next;
    setFormState(next);
  };

  const updatePhoto = (id: string, patch: Partial<AssetPhoto>) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, ...patch } : photo,
      ),
    );
  };

  useEffect(() => {
    if (!processing && !saving) return;
    return navigation.addListener('beforeRemove', (event) => {
      if (saved.current) return;
      event.preventDefault();
    });
  }, [navigation, processing, saving]);

  useEffect(
    () => () => {
      if (saved.current) return;
      const paths = photosRef.current.flatMap((photo) => [
        ...(photo.path ? [photo.path] : []),
        ...(photo.cutoutPath ? [photo.cutoutPath] : []),
      ]);
      removePhotos(paths).catch(() => undefined);
    },
    [],
  );

  const processPhoto = async (
    photoId: string,
    retryRecognition: boolean,
    retryCutout: boolean,
  ) => {
    let photo = photosRef.current.find((item) => item.id === photoId);
    if (!photo || !session) return;

    updatePhoto(photoId, {
      ...(retryRecognition ? { recognitionStatus: 'processing' as const } : {}),
      ...(retryCutout ? { cutoutStatus: 'processing' as const } : {}),
    });

    if (!photo.path || !photo.analysisUrl) {
      try {
        const uploaded = await uploadPhoto(
          photo.base64 ?? '',
          session.user.id,
        );
        updatePhoto(photoId, {
          path: uploaded.path,
          analysisUrl: uploaded.signedUrl,
        });
        photo = { ...photo, path: uploaded.path, analysisUrl: uploaded.signedUrl };
      } catch {
        updatePhoto(photoId, {
          ...(retryRecognition ? { recognitionStatus: 'failed' as const } : {}),
          ...(retryCutout ? { cutoutStatus: 'failed' as const } : {}),
        });
        return;
      }
    }

    const analysisUrl = photo.analysisUrl;
    if (!analysisUrl) {
      updatePhoto(photoId, {
        ...(retryRecognition ? { recognitionStatus: 'failed' as const } : {}),
        ...(retryCutout ? { cutoutStatus: 'failed' as const } : {}),
      });
      return;
    }

    const [recognitionResult, cutoutResult] = await Promise.allSettled([
      retryRecognition
        ? analyzePhotos([analysisUrl], formRef.current)
        : Promise.resolve(null),
      retryCutout
        ? cutoutPhoto(analysisUrl)
        : Promise.resolve(null),
    ]);

    if (retryRecognition) {
      if (
        recognitionResult.status === 'fulfilled' &&
        recognitionResult.value
      ) {
        const merged = mergeRecognition(
          formRef.current,
          recognitionResult.value,
          protectedFields.current,
        );
        setForm(merged);
        if (!protectedFields.current.has('specs')) {
          setSpecsText(specsToText(merged.specs));
        }
        updatePhoto(photoId, { recognitionStatus: 'succeeded' });
      } else {
        updatePhoto(photoId, { recognitionStatus: 'failed' });
      }
    }

    if (retryCutout) {
      const base64 =
        cutoutResult.status === 'fulfilled' ? cutoutResult.value : null;
      if (base64) {
        try {
          const uploaded = await uploadCover(base64, session.user.id);
          updatePhoto(photoId, {
            cutoutPath: uploaded.path,
            cutoutUrl: uploaded.signedUrl,
            cutoutStatus: 'succeeded',
          });
        } catch {
          updatePhoto(photoId, { cutoutStatus: 'failed' });
        }
      } else {
        updatePhoto(photoId, { cutoutStatus: 'failed' });
      }
    }
  };

  const addPhotos = async (added: AssetPhoto[]) => {
    if (!session || processing) return;
    setError('');
    const queued = added.map((photo) => ({
      ...photo,
      recognitionStatus: 'pending' as const,
      cutoutStatus: 'pending' as const,
    }));
    setPhotos((current) => [...current, ...queued]);
    setProcessing(true);
    try {
      for (const photo of queued) {
        await processPhoto(photo.id, true, true);
      }
    } finally {
      setProcessing(false);
    }
  };

  const addInitialPhotos = useEffectEvent(addPhotos);

  useEffect(() => {
    if (camera !== '1' || openedInitialCamera.current || !session) return;
    openedInitialCamera.current = true;

    const returnHome = () => router.replace('/(tabs)/(assets)');
    const fail = (message: string) =>
      Alert.alert(
        '无法拍照',
        message,
        [{ text: '知道了', onPress: returnHome }],
        { cancelable: false },
      );

    void (async () => {
      try {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          fail('需要相机权限才能拍照');
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          base64: true,
          quality: 0.8,
          cameraType: ImagePicker.CameraType.back,
        });
        if (result.canceled) {
          returnHome();
          return;
        }

        const firstPhoto = pickerAssetsToPhotos(result.assets, 1);
        if (!firstPhoto.length) {
          fail('无法读取拍摄的照片');
          return;
        }
        await addInitialPhotos(firstPhoto);
      } catch (caught) {
        fail(caught instanceof Error ? caught.message : '拍照失败');
      }
    })();
  }, [camera, session]);

  const retryPhoto = async (photo: AssetPhoto) => {
    if (processing) return;
    setError('');
    setProcessing(true);
    try {
      await processPhoto(
        photo.id,
        photo.recognitionStatus === 'failed',
        photo.cutoutStatus === 'failed',
      );
    } finally {
      setProcessing(false);
    }
  };

  const changePhotos = (next: AssetPhoto[]) => {
    const removed = photosRef.current.filter(
      (photo) => !next.some((item) => item.id === photo.id),
    );
    setPhotos(next);
    removePhotos(
      removed.flatMap((photo) => [
        ...(photo.path ? [photo.path] : []),
        ...(photo.cutoutPath ? [photo.cutoutPath] : []),
      ]),
    ).catch(() => undefined);
  };

  const changeForm = (next: AssetInput) => {
    for (const field of recognizedFields) {
      if (next[field] !== formRef.current[field]) {
        protectedFields.current.add(field);
      }
    }
    setForm(next);
  };

  const changeSpecs = (value: string) => {
    protectedFields.current.add('specs');
    setSpecsText(value);
    setForm({ ...formRef.current, specs: textToSpecs(value) });
  };

  const canSave =
    photos.length > 0 &&
    !processing &&
    !saving &&
    photos.every((photo) => photo.recognitionStatus === 'succeeded');

  const save = async () => {
    if (!canSave) {
      setError('请等待所有照片解析完成，或重试失败的照片');
      return;
    }
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

    setSaving(true);
    setError('');
    const input = {
      ...form,
      ...purchase.input,
      specs: textToSpecs(specsText),
    };
    const photoPaths = photos.map((photo) => photo.path as string);
    const photoCutoutPaths = Object.fromEntries(
      photos.flatMap((photo) =>
        photo.path && photo.cutoutPath
          ? [[photo.path, photo.cutoutPath]]
          : [],
      ),
    );

    try {
      const asset = await createAsset(
        session!.user.id,
        photoPaths,
        input,
        photoCutoutPaths,
      );
      saved.current = true;
      try {
        const valuation = await estimateAsset(input);
        await recordValuation(asset.id, valuation);
      } catch {
        // The asset is valid even when its first valuation is temporarily unavailable.
      }
      await queryClient
        .invalidateQueries({ queryKey: ['assets'] })
        .catch(() => undefined);
      router.replace('/(tabs)/(assets)');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: '录入物品', headerShown: true }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
          <Text
            selectable
            style={{ color: colors.textSecondary, ...typography.body }}>
            每张照片会依次解析并更新下方信息
          </Text>
          <AssetPhotoPicker
            photos={photos}
            disabled={processing || saving}
            allowEmpty
            onAdd={(added) => void addPhotos(added)}
            onChange={changePhotos}
            onRetry={(photo) => void retryPhoto(photo)}
            onError={setError}
          />
          <AssetFormFields
            form={form}
            specsText={specsText}
            onChange={changeForm}
            onChangeSpecsText={changeSpecs}
          />
          {error ? (
            <Text
              selectable
              style={{ color: colors.danger, ...typography.body }}>
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={!canSave}
            onPress={save}
            style={({ pressed }) => ({
              alignItems: 'center',
              minHeight: 52,
              justifyContent: 'center',
              padding: spacing.lg,
              borderRadius: radius.medium,
              borderCurve: 'continuous',
              backgroundColor: colors.textPrimary,
              opacity: pressed || !canSave ? 0.65 : 1,
            })}>
            {saving ? (
              <ActivityIndicator color={colors.onDark} />
            ) : (
              <Text
                style={{
                  color: colors.onDark,
                  ...typography.body,
                  fontWeight: '700',
                }}>
                保存并估价
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
