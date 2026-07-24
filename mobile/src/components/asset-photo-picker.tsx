import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import Sortable from 'react-native-sortables';

import { colors } from '@/constants/colors';
import {
  maxAssetPhotos,
  setCover,
  type AssetPhoto,
} from '@/lib/photos';

export function AssetPhotoPicker({
  photos,
  onChange,
  onError,
  title = '照片',
  minimumPhotos = 1,
}: {
  photos: AssetPhoto[];
  onChange: (photos: AssetPhoto[]) => void;
  onError: (message: string) => void;
  title?: string;
  minimumPhotos?: number;
}) {
  const add = (assets: ImagePicker.ImagePickerAsset[]) => {
    const remaining = maxAssetPhotos - photos.length;
    const next = assets.slice(0, remaining).flatMap((asset, index) =>
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
    if (next.length !== assets.slice(0, remaining).length) {
      onError('无法读取所选照片');
      return;
    }
    onError('');
    onChange([...photos, ...next]);
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
    <View style={{ gap: 12 }}>
      <Text
        selectable
        style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>
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
          keyExtractor={(photo) => photo.id}
          onDragEnd={({ data }) => onChange(data)}
          renderItem={({ item: photo, index }) => (
            <View style={{ width: 104, gap: 6 }}>
              <Pressable
                accessibilityLabel={
                  index === 0 ? '当前封面' : `将第 ${index + 1} 张设为封面`
                }
                accessibilityHint="长按拖动可调整顺序"
                onPress={() => onChange(setCover(photos, index))}>
                <Image
                  source={photo.uri}
                  contentFit="cover"
                  style={{ width: 104, height: 104, borderRadius: 14 }}
                />
                <Text
                  style={{
                    position: 'absolute',
                    left: 6,
                    bottom: 6,
                    color: 'white',
                    backgroundColor: 'rgba(0,0,0,0.58)',
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: 99,
                    overflow: 'hidden',
                    fontSize: 12,
                  }}>
                  {index === 0 ? '封面' : '设为封面'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={photos.length <= minimumPhotos}
                onPress={() =>
                  onChange(photos.filter((item) => item.id !== photo.id))
                }>
                <Text
                  style={{
                    color: colors.danger,
                    textAlign: 'center',
                    opacity: photos.length <= minimumPhotos ? 0.4 : 1,
                  }}>
                  删除
                </Text>
              </Pressable>
            </View>
          )}
        />
        {photos.length < maxAssetPhotos ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加照片"
            onPress={chooseSource}
            style={({ pressed }) => ({
              width: 104,
              height: 104,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: 14,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: colors.green,
              backgroundColor: colors.card,
              opacity: pressed ? 0.65 : 1,
            })}>
            <Text style={{ color: colors.green, fontSize: 28 }}>＋</Text>
            <Text style={{ color: colors.green, fontWeight: '700' }}>
              添加照片
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
