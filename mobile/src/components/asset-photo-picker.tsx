import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Sortable from 'react-native-sortables';

import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  maxAssetPhotos,
  pickerAssetsToPhotos,
  setCover,
  type AssetPhoto,
} from '@/lib/photos';

function photoStatus(photo: AssetPhoto) {
  if (
    photo.recognitionStatus === 'processing' ||
    photo.cutoutStatus === 'processing'
  )
    return '处理中';
  if (
    photo.recognitionStatus === 'failed' &&
    photo.cutoutStatus === 'failed'
  )
    return '处理失败';
  if (photo.recognitionStatus === 'failed') return '解析失败';
  if (photo.cutoutStatus === 'failed') return '抠图失败';
  if (
    photo.recognitionStatus === 'succeeded' &&
    photo.cutoutStatus === 'succeeded'
  )
    return '已解析';
  if (photo.recognitionStatus || photo.cutoutStatus) return '等待处理';
  return '';
}

export function AssetPhotoPicker({
  photos,
  disabled = false,
  allowEmpty = false,
  onAdd,
  onChange,
  onRetry,
  onError,
  title = '照片',
  minimumPhotos = 1,
}: {
  photos: AssetPhoto[];
  disabled?: boolean;
  allowEmpty?: boolean;
  onAdd?: (photos: AssetPhoto[]) => void;
  onChange: (photos: AssetPhoto[]) => void;
  onRetry?: (photo: AssetPhoto) => void;
  onError: (message: string) => void;
  title?: string;
  minimumPhotos?: number;
}) {
  const add = (assets: ImagePicker.ImagePickerAsset[]) => {
    const remaining = maxAssetPhotos - photos.length;
    const selected = assets.slice(0, remaining);
    const next = pickerAssetsToPhotos(selected, remaining);
    if (next.length !== selected.length) {
      onError('无法读取所选照片');
      return;
    }
    onError('');
    if (onAdd) onAdd(next);
    else onChange([...photos, ...next]);
  };

  const takePhoto = async () => {
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
      if (!result.canceled) add(result.assets);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '拍照失败');
    }
  };

  const pickPhotos = async () => {
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
        selectionLimit: maxAssetPhotos - photos.length,
        base64: true,
        quality: 0.8,
      });
      if (!result.canceled) add(result.assets);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '选择照片失败');
    }
  };

  const chooseSource = () => {
    Alert.alert('添加照片', '请选择照片来源', [
      { text: '拍照', onPress: () => void takePhoto() },
      { text: '从相册选择', onPress: () => void pickPhotos() },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Text
        selectable
        style={{ color: colors.textPrimary, ...typography.body, fontWeight: '700' }}>
        {title} {photos.length}/{maxAssetPhotos}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', gap: 10 }}>
        <Sortable.Grid
          data={photos}
          rows={1}
          rowHeight={140}
          columnGap={10}
          activeItemScale={1.04}
          sortEnabled={!disabled}
          keyExtractor={(photo) => photo.id}
          onDragEnd={({ data }) => onChange(data)}
          renderItem={({ item: photo, index }) => {
            const failed =
              photo.recognitionStatus === 'failed' ||
              photo.cutoutStatus === 'failed';
            return (
              <View style={{ width: 104, gap: 6 }}>
              <Pressable
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={
                  index === 0 ? '当前封面' : `将第 ${index + 1} 张设为封面`
                }
                accessibilityHint="长按拖动可调整顺序"
                onPress={() => onChange(setCover(photos, index))}>
                <Image
                  source={photo.cutoutUrl ?? photo.uri}
                  contentFit={photo.cutoutUrl ? 'contain' : 'cover'}
                  style={{
                    width: 104,
                    height: 104,
                    borderRadius: radius.small,
                    backgroundColor: colors.surfaceMuted,
                    opacity: disabled ? 0.65 : 1,
                  }}
                />
                {photoStatus(photo) ? (
                  <Text
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      color: colors.onDark,
                      backgroundColor: 'rgba(11,11,13,0.58)',
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      overflow: 'hidden',
                      fontSize: 11,
                    }}>
                    {photoStatus(photo)}
                  </Text>
                ) : null}
                <Text
                  style={{
                    position: 'absolute',
                    left: 6,
                    bottom: 6,
                    color: colors.onDark,
                    backgroundColor: 'rgba(11,11,13,0.58)',
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: radius.pill,
                    overflow: 'hidden',
                    fontSize: 12,
                  }}>
                  {index === 0 ? '封面' : '设为封面'}
                </Text>
              </Pressable>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-around',
                }}>
                {failed && onRetry ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={disabled}
                    onPress={() => onRetry(photo)}>
                    <Text
                      style={{
                        color: colors.textPrimary,
                        opacity: disabled ? 0.4 : 1,
                      }}>
                      重试
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    disabled ||
                    photos.length <= (allowEmpty ? 0 : minimumPhotos)
                  }
                  onPress={() =>
                    onChange(
                      photos.filter((item) => item.id !== photo.id),
                    )
                  }>
                  <Text
                    style={{
                      color: colors.danger,
                      opacity:
                        disabled ||
                        photos.length <= (allowEmpty ? 0 : minimumPhotos)
                          ? 0.4
                          : 1,
                    }}>
                    删除
                  </Text>
                </Pressable>
              </View>
            </View>
            );
          }}
        />
        {photos.length < maxAssetPhotos ? (
          <Pressable
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="添加照片"
            onPress={chooseSource}
            style={({ pressed }) => ({
              width: 104,
              height: 104,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: radius.small,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: pressed || disabled ? 0.65 : 1,
            })}>
            <Text style={{ color: colors.textSecondary, fontSize: 28 }}>＋</Text>
            <Text
              style={{
                color: colors.textSecondary,
                fontWeight: '600',
                fontSize: 12,
              }}>
              添加照片
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
