import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import type { Asset } from '@/types/domain';

export function AssetCard({ asset }: { asset: Asset }) {
  return (
    <Link href={{ pathname: '/asset/[id]', params: { id: asset.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => ({
          gap: 8,
          padding: 10,
          borderRadius: 18,
          borderCurve: 'continuous',
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        })}>
        <Image
          source={asset.photo_urls?.[0]}
          contentFit="cover"
          style={{ width: '100%', aspectRatio: 1, borderRadius: 14 }}
        />
        <Text
          selectable
          numberOfLines={1}
          style={{ color: colors.text, fontWeight: '700' }}>
          {asset.name}
        </Text>
        <Text
          selectable
          numberOfLines={1}
          style={{
            alignSelf: 'flex-start',
            color: colors.green,
            backgroundColor: colors.greenSoft,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 99,
            overflow: 'hidden',
            fontSize: 12,
          }}>
          {asset.category}
        </Text>
        <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
          当前参考市价
        </Text>
        <Text
          selectable
          style={{
            color:
              asset.latest_market_price === null
                ? colors.muted
                : colors.green,
            fontSize: 18,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}>
          {formatCurrency(asset.latest_market_price)}
        </Text>
      </Pressable>
    </Link>
  );
}
