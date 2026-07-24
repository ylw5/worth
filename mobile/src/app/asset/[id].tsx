import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AssetPhotoGallery } from '@/components/asset-photo-gallery';
import { MarketValuationCard } from '@/components/market-valuation-card';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { assetStatusLabels } from '@/lib/asset-status';
import { getAsset, getAssetSale, getMarketInsight } from '@/lib/assets';
import { formatCurrency, formatDate, specsToText } from '@/lib/format';

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => getAsset(id),
    enabled: Boolean(id),
  });
  const saleQuery = useQuery({
    queryKey: ['asset-sale', id],
    queryFn: () => getAssetSale(id),
    enabled: Boolean(id) && assetQuery.data?.status === 'sold',
  });
  const insightQuery = useQuery({
    queryKey: ['market-insight', id],
    queryFn: () => getMarketInsight(assetQuery.data!),
    enabled: Boolean(assetQuery.data),
  });

  if (assetQuery.isLoading) return <LoadingState />;
  if (assetQuery.error) return <ErrorState message={assetQuery.error.message} />;
  const asset = assetQuery.data;
  if (!asset) return <ErrorState message="资产不存在" />;

  const details: [string, string][] = [
    ['分类', asset.category],
    ['二级品类', asset.subcategory || '—'],
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
    ...(asset.status === 'sold'
      ? [
          ['成交日期', saleQuery.data?.sold_at ?? '—'] as [string, string],
          [
            '成交价',
            saleQuery.data
              ? formatCurrency(saleQuery.data.sale_price)
              : '—',
          ] as [string, string],
        ]
      : []),
    ['添加时间', formatDate(asset.created_at)],
  ];
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
        {insightQuery.error ? (
          <Text
            selectable
            style={{ color: colors.danger, ...typography.label }}>
            {insightQuery.error.message}
          </Text>
        ) : insightQuery.data ? (
          <MarketValuationCard insight={insightQuery.data} />
        ) : (
          <View
            style={{
              padding: spacing.lg,
              borderRadius: radius.large,
              borderCurve: 'continuous',
              backgroundColor: colors.surface,
            }}>
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              行情加载中
            </Text>
          </View>
        )}

        <View
          style={{
            padding: spacing.lg,
            gap: spacing.lg,
            borderRadius: radius.large,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
          }}>
          <Link
            href={{
              pathname: '/asset/[id]/status',
              params: { id: asset.id },
            }}
            asChild>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.xl,
                opacity: pressed ? 0.65 : 1,
              })}>
              <Text
                selectable
                style={{ color: colors.textSecondary, ...typography.label }}>
                物品状态
              </Text>
              <Text
                style={{
                  color:
                    asset.status === 'sold'
                      ? colors.textSecondary
                      : colors.textPrimary,
                  ...typography.body,
                  fontWeight: '600',
                }}>
                {assetStatusLabels[asset.status]} ›
              </Text>
            </Pressable>
          </Link>
          <View style={{ height: 1, backgroundColor: colors.border }} />
          {saleQuery.error ? (
            <Text selectable style={{ color: colors.danger, ...typography.label }}>
              {saleQuery.error.message}
            </Text>
          ) : null}
          {details.map(([label, value], index, rows) => (
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
        </View>
      </ScrollView>
    </>
  );
}
