import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency, formatOwnershipMeta } from '@/lib/format';
import type { Asset } from '@/types/domain';

export function AssetCard({ asset }: { asset: Asset }) {
  const meta = formatOwnershipMeta(asset.purchase_price, asset.purchase_date);
  const pending = asset.latest_market_price === null;

  return (
    <Link href={{ pathname: '/asset/[id]', params: { id: asset.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => ({
          padding: spacing.sm,
          borderRadius: radius.large,
          borderCurve: 'continuous',
          backgroundColor: colors.surface,
          opacity: pressed ? 0.65 : 1,
        })}>
        <View
          style={{
            aspectRatio: 1,
            borderRadius: radius.small,
            backgroundColor: colors.surfaceMuted,
            overflow: 'hidden',
          }}>
          <Image
            source={asset.photo_urls?.[0]}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        </View>
        <View style={{ paddingTop: spacing.sm, gap: spacing.xs }}>
          <Text
            selectable
            numberOfLines={2}
            style={{
              color: colors.textPrimary,
              fontSize: 14,
              fontWeight: '600',
              lineHeight: 18,
            }}>
            {asset.name}
          </Text>
          <Text
            selectable
            style={{
              color: pending ? colors.textSecondary : colors.textPrimary,
              fontSize: 15,
              fontWeight: '600',
              fontVariant: ['tabular-nums'],
              lineHeight: 20,
            }}>
            {formatCurrency(asset.latest_market_price)}
          </Text>
          {meta ? (
            <Text
              selectable
              numberOfLines={1}
              style={{ color: colors.textSecondary, ...typography.caption }}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
