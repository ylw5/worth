import { Host, Icon } from '@expo/ui';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '@/constants/colors';
import { maxAssetPhotos, type AssetPhoto } from '@/lib/photos';

const addIcon = Icon.select({
  ios: 'plus',
  android: import('@expo/material-symbols/add.xml'),
});
const sendIcon = Icon.select({
  ios: 'arrow.up',
  android: import('@expo/material-symbols/arrow_upward.xml'),
});
const closeIcon = Icon.select({
  ios: 'xmark',
  android: import('@expo/material-symbols/close.xml'),
});

export function EvaluationComposer({
  value,
  photos,
  loading,
  onChangeText,
  onChangePhotos,
  onError,
  onSubmit,
}: {
  value: string;
  photos: AssetPhoto[];
  loading: boolean;
  onChangeText: (value: string) => void;
  onChangePhotos: (photos: AssetPhoto[]) => void;
  onError: (message: string) => void;
  onSubmit: () => void;
}) {
  const addPhotos = (assets: ImagePicker.ImagePickerAsset[]) => {
    const remaining = maxAssetPhotos - photos.length;
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
    onChangePhotos([...photos, ...next]);
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
      if (!result.canceled) addPhotos(result.assets);
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
      if (!result.canceled) addPhotos(result.assets);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '选择照片失败');
    }
  };

  const chooseSource = () => {
    if (photos.length >= maxAssetPhotos) {
      onError(`最多添加 ${maxAssetPhotos} 张图片`);
      return;
    }
    Alert.alert('添加商品图片', '请选择图片来源', [
      { text: '拍照', onPress: () => void takePhoto() },
      { text: '从相册选择', onPress: () => void pickPhotos() },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const disabled = loading || (!value.trim() && !photos.length);

  return (
    <View
      style={{
        gap: 10,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 11,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 26,
        borderCurve: 'continuous',
        boxShadow: '0 5px 18px rgba(29, 33, 30, 0.06)',
      }}>
      {photos.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 9 }}>
          {photos.map((photo, index) => (
            <View key={photo.id}>
              <Image
                source={photo.uri}
                contentFit="cover"
                style={{ width: 68, height: 68, borderRadius: 12 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`删除第 ${index + 1} 张图片`}
                onPress={() =>
                  onChangePhotos(
                    photos.filter((candidate) => candidate.id !== photo.id),
                  )
                }
                style={({ pressed }) => ({
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 23,
                  height: 23,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 99,
                  backgroundColor: 'rgba(29, 33, 30, 0.72)',
                  opacity: pressed ? 0.65 : 1,
                })}>
                <Host matchContents>
                  <Icon name={closeIcon} size={13} color="white" />
                </Host>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <TextInput
        accessibilityLabel="描述商品或粘贴链接"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        onChangeText={onChangeText}
        placeholder="描述商品、粘贴链接，或添加图片…"
        placeholderTextColor="#A7AAA7"
        value={value}
        style={{
          minHeight: photos.length ? 54 : 76,
          maxHeight: 150,
          paddingHorizontal: 3,
          paddingTop: 2,
          color: colors.text,
          fontSize: 17,
          lineHeight: 24,
          textAlignVertical: 'top',
        }}
      />

      <View
        style={{
          minHeight: 42,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加图片或拍照"
          onPress={chooseSource}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 99,
            backgroundColor: colors.background,
            opacity: pressed ? 0.62 : 1,
          })}>
          <Host matchContents>
            <Icon name={addIcon} size={24} color={colors.text} />
          </Host>
        </Pressable>

        <Text
          selectable
          numberOfLines={1}
          style={{ flex: 1, color: colors.muted, fontSize: 13 }}>
          链接 · 文字 · 图片 · 拍照
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送并开始评估"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onSubmit}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 99,
            backgroundColor: disabled ? '#D8D9D7' : colors.green,
            opacity: pressed ? 0.68 : 1,
          })}>
          {loading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <Host matchContents>
              <Icon name={sendIcon} size={22} color="white" />
            </Host>
          )}
        </Pressable>
      </View>
    </View>
  );
}