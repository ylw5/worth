import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { colors, radius } from '@/constants/colors';

export function AssetPhotoGallery({ urls }: { urls: string[] }) {
  const [selected, setSelected] = useState(0);

  return (
    <View style={{ gap: 10 }}>
      <Image
        source={urls[selected] ?? urls[0]}
        contentFit="contain"
        style={{
          width: '100%',
          aspectRatio: 1.3,
          borderRadius: radius.large,
          backgroundColor: colors.surfaceMuted,
        }}
      />
      {urls.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}>
          {urls.map((url, index) => (
            <Pressable
              key={url}
              accessibilityLabel={`查看第 ${index + 1} 张照片`}
              onPress={() => setSelected(index)}
              style={{
                padding: 2,
                borderRadius: radius.small,
                borderWidth: 2,
                borderColor:
                  (urls[selected] ?? urls[0]) === url
                    ? colors.accent
                    : 'transparent',
              }}>
              <Image
                source={url}
                contentFit="cover"
                style={{ width: 68, height: 68, borderRadius: 9 }}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
