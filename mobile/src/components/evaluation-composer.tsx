import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing } from '@/constants/colors';
import { maxAssetPhotos, type AssetPhoto } from '@/lib/photos';

const COMPOSER_CONTROL_SIZE = 48;
const SEND_BUTTON_SIZE = 36;

export function EvaluationComposer({
  value,
  photos,
  loading,
  accessibilityLabel = '描述商品或粘贴链接',
  onChangeText,
  onChangePhotos,
  onError,
  onSubmit,
}: {
  value: string;
  photos?: AssetPhoto[];
  loading: boolean;
  accessibilityLabel?: string;
  onChangeText: (value: string) => void;
  onChangePhotos?: (photos: AssetPhoto[]) => void;
  onError?: (message: string) => void;
  onSubmit: () => void;
}) {
  const attachedPhotos = photos ?? [];
  const allowPhotos = Boolean(onChangePhotos);

  const addPhotos = (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!onChangePhotos || !onError) return;
    const remaining = maxAssetPhotos - attachedPhotos.length;
    const selected = assets.slice(0, remaining);
    const next = selected.flatMap((asset, index) =>
      asset.base64
        ? [
            {
              id: `${asset.uri}-${Date.now()}-${index}`,
              uri: asset.uri,
              base64: asset.base64,
            },
          ]
        : [],
    );
    if (next.length !== selected.length) {
      onError('无法读取所选照片');
      return;
    }
    onError('');
    onChangePhotos([...attachedPhotos, ...next]);
  };

  const takePhoto = async () => {
    if (!onError) return;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError('需要相机权限才能拍照');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.8,
        cameraType: ImagePicker.CameraType.back,
      });
      if (!result.canceled) addPhotos(result.assets);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '拍照失败');
    }
  };

  const pickPhotos = async () => {
    if (!onError) return;
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onError('需要相册权限才能选择照片');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: maxAssetPhotos - attachedPhotos.length,
        base64: true,
        quality: 0.8,
      });
      if (!result.canceled) addPhotos(result.assets);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '选择照片失败');
    }
  };

  const chooseSource = () => {
    if (!onError) return;
    if (attachedPhotos.length >= maxAssetPhotos) {
      onError(`最多添加 ${maxAssetPhotos} 张图片`);
      return;
    }
    Alert.alert('添加商品图片', '请选择图片来源', [
      { text: '拍照', onPress: () => void takePhoto() },
      { text: '从相册选择', onPress: () => void pickPhotos() },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const canSend =
    !loading && (Boolean(value.trim()) || attachedPhotos.length > 0);

  return (
    <View style={{ gap: spacing.sm }}>
      {attachedPhotos.length && onChangePhotos ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.sm,
            paddingLeft: allowPhotos ? COMPOSER_CONTROL_SIZE + spacing.sm : 0,
          }}>
          {attachedPhotos.map((photo, index) => (
            <View key={photo.id}>
              <Image
                source={photo.uri}
                contentFit="cover"
                style={{ width: 64, height: 64, borderRadius: 12 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`删除第 ${index + 1} 张图片`}
                onPress={() =>
                  onChangePhotos(
                    attachedPhotos.filter(
                      (candidate) => candidate.id !== photo.id,
                    ),
                  )
                }
                style={({ pressed }) => ({
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 22,
                  height: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 99,
                  backgroundColor: 'rgba(11, 11, 13, 0.72)',
                  opacity: pressed ? 0.65 : 1,
                })}>
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={12}
                  tintColor="white"
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}>
        {allowPhotos ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加图片或拍照"
            onPress={chooseSource}
            style={({ pressed }) => ({
              width: COMPOSER_CONTROL_SIZE,
              height: COMPOSER_CONTROL_SIZE,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            })}>
            <SymbolView
              name={{ ios: 'photo', android: 'image', web: 'image' }}
              size={20}
              tintColor={colors.textPrimary}
            />
          </Pressable>
        ) : null}

        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            height: COMPOSER_CONTROL_SIZE,
            paddingLeft: spacing.md,
            paddingRight: 4,
            backgroundColor: colors.surface,
            borderRadius: radius.pill,
            borderCurve: 'continuous',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            boxShadow: '0 4px 16px rgba(11, 11, 13, 0.08)',
          }}>
          <TextInput
            accessibilityLabel={accessibilityLabel}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChangeText}
            value={value}
            style={{
              flex: 1,
              minWidth: 0,
              height: COMPOSER_CONTROL_SIZE - 2,
              paddingTop: 0,
              paddingBottom: 0,
              color: colors.textPrimary,
              fontSize: 16,
              lineHeight: 20,
              textAlignVertical: 'center',
            }}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={onSubmit}
            style={({ pressed }) => ({
              width: SEND_BUTTON_SIZE,
              height: SEND_BUTTON_SIZE,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: canSend ? colors.accent : colors.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            })}>
            <SymbolView
              name={{
                ios: 'arrow.up',
                android: 'arrow_upward',
                web: 'arrow_upward',
              }}
              size={16}
              tintColor={canSend ? colors.onDark : colors.textTertiary}
            />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
