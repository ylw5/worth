import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency, formatOwnershipMeta } from '@/lib/format';
import { getAssetCoverUrl } from '@/lib/incremental-import';
import type { Asset } from '@/types/domain';

export function AssetCard({ asset }: { asset: Asset }) {
  const meta = formatOwnershipMeta(asset.purchase_price, asset.purchase_date);
  const pending = asset.latest_market_price === null;
  const coverPath = asset.photo_paths[0];
  const hasCutout = Boolean(
    coverPath && asset.photo_cutout_urls?.[coverPath],
  );

  return (
    <Link href={{ pathname: '/asset/[id]', params: { id: asset.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => ({
          width: '100%',
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
            source={getAssetCoverUrl(asset)}
            contentFit={hasCutout ? 'contain' : 'cover'}
            style={{ width: '100%', height: '100%' }}
          />
        </View>
        <View style={{ width: '100%', paddingTop: spacing.sm, gap: spacing.xs }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: colors.textPrimary,
              fontSize: 14,
              fontWeight: '600',
              lineHeight: 20,
            }}>
            {asset.name}
          </Text>
          <Text
            style={{
              color: pending ? colors.textSecondary : colors.textPrimary,
              fontSize: 13,
              fontWeight: pending ? '500' : '600',
              fontVariant: ['tabular-nums'],
              lineHeight: 18,
            }}>
            {formatCurrency(asset.latest_market_price)}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ color: colors.textSecondary, ...typography.caption }}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}
