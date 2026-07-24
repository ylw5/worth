import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AssetPhotoGallery } from '@/components/asset-photo-gallery';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { ValueInsights } from '@/components/value-insights';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { getAsset, getMarketInsight, getValuations } from '@/lib/assets';
import { formatCurrency, formatDate, specsToText } from '@/lib/format';

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => getAsset(id),
    enabled: Boolean(id),
  });
  const historyQuery = useQuery({
    queryKey: ['valuations', id],
    queryFn: () => getValuations(id),
    enabled: Boolean(id),
  });
  const marketQuery = useQuery({
    queryKey: ['market-insight', id],
    queryFn: () => getMarketInsight(assetQuery.data!),
    enabled: Boolean(assetQuery.data),
  });

  if (assetQuery.isLoading) return <LoadingState />;
  if (assetQuery.error) return <ErrorState message={assetQuery.error.message} />;
  const asset = assetQuery.data;
  if (!asset) return <ErrorState message="资产不存在" />;

  return (
    <>
      <Stack.Screen
        options={{
          title: asset.name,
          headerRight: () => (
            <Link
              href={{
                pathname: '/asset/[id]/edit',
                params: { id: asset.id },
              }}
              asChild>
              <Pressable accessibilityRole="button" hitSlop={8}>
                <Text
                  style={{
                    ...typography.body,
                    color: colors.textPrimary,
                    fontWeight: '700',
                  }}>
                  编辑
                </Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
        <AssetPhotoGallery urls={asset.photo_urls ?? []} />
        <ValueInsights
          asset={asset}
          insight={
            marketQuery.data ?? {
              snapshots: [],
              run: null,
              forecast: null,
            }
          }
        />

        <View
          style={{
            padding: spacing.lg,
            gap: spacing.lg,
            borderRadius: radius.large,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
          }}>
          {[
            ['分类', asset.category],
            ['品牌型号', [asset.brand, asset.model].filter(Boolean).join(' ')],
            ['规格', specsToText(asset.specs) || '—'],
            ['成色', asset.condition || '—'],
            ['买入日期', asset.purchase_date || '—'],
            [
              '买入价格',
              asset.purchase_price === null
                ? '—'
                : formatCurrency(asset.purchase_price),
            ],
            ['添加时间', formatDate(asset.created_at)],
          ].map(([label, value], index, rows) => (
            <View key={label}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: spacing.xl,
                }}>
                <Text
                  selectable
                  style={{ color: colors.textSecondary, ...typography.label }}>
                  {label}
                </Text>
                <Text
                  selectable
                  style={{
                    flex: 1,
                    color: colors.textPrimary,
                    textAlign: 'right',
                    ...typography.body,
                  }}>
                  {value}
                </Text>
              </View>
              {index < rows.length - 1 ? (
                <View
                  style={{
                    height: 1,
                    backgroundColor: colors.border,
                    marginTop: spacing.lg,
                  }}
                />
              ) : null}
            </View>
          ))}
          {asset.status !== 'sold' ? (
            <Link
              href={{
                pathname: '/asset/[id]/sale',
                params: { id: asset.id },
              }}
              asChild>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.small,
                  backgroundColor: colors.surfaceMuted,
                  opacity: pressed ? 0.65 : 1,
                })}>
                <Text
                  style={{
                    color: colors.textPrimary,
                    ...typography.body,
                    fontWeight: '700',
                  }}>
                  已出售
                </Text>
              </Pressable>
            </Link>
          ) : null}
        </View>

        <View style={{ gap: spacing.md }}>
          <Text
            selectable
            style={{ color: colors.textPrimary, ...typography.sectionTitle }}>
            价格历史
          </Text>
          {historyQuery.data?.map((valuation, index) => (
            <View
              key={valuation.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                padding: spacing.lg,
                borderRadius: radius.medium,
                borderCurve: 'continuous',
                backgroundColor: colors.surface,
              }}>
              <Text
                selectable
                style={{ color: colors.textSecondary, ...typography.label }}>
                {formatDate(valuation.created_at)}
              </Text>
              <Text
                selectable
                style={{
                  ...typography.body,
                  color: index === 0 ? colors.accent : colors.textPrimary,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}>
                {formatCurrency(valuation.estimated_price)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}
