import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { AssetPhotoGallery } from '@/components/asset-photo-gallery';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { estimateAsset } from '@/lib/api';
import { assetStatusLabels } from '@/lib/asset-status';
import {
  getAsset,
  getAssetSale,
  getValuations,
  recordValuation,
} from '@/lib/assets';
import { formatCurrency, formatDate, specsToText } from '@/lib/format';

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
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
  const saleQuery = useQuery({
    queryKey: ['asset-sale', id],
    queryFn: () => getAssetSale(id),
    enabled: Boolean(id) && assetQuery.data?.status === 'sold',
  });
  const refresh = useMutation({
    mutationFn: async () => {
      if (!assetQuery.data) return;
      const valuation = await estimateAsset(assetQuery.data);
      await recordValuation(assetQuery.data.id, valuation);
      return valuation;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset', id] }),
        queryClient.invalidateQueries({ queryKey: ['valuations', id] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
    },
  });

  if (assetQuery.isLoading) return <LoadingState />;
  if (assetQuery.error) return <ErrorState message={assetQuery.error.message} />;
  const asset = assetQuery.data;
  if (!asset) return <ErrorState message="资产不存在" />;

  const latest = historyQuery.data?.[0];
  const details: [string, string][] = [
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
        <View
          style={{
            padding: spacing.lg,
            gap: spacing.sm,
            borderRadius: radius.large,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
          }}>
          <Text
            selectable
            style={{ color: colors.textSecondary, ...typography.label }}>
            当前参考市价
          </Text>
          <Text
            selectable
            style={{
              color:
                asset.latest_market_price === null
                  ? colors.textTertiary
                  : colors.textPrimary,
              ...typography.display,
              fontVariant: ['tabular-nums'],
            }}>
            {formatCurrency(asset.latest_market_price)}
          </Text>
          {latest ? (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              {formatCurrency(latest.price_low)}–
              {formatCurrency(latest.price_high)} · {latest.sample_count}{' '}
              个相似样本
            </Text>
          ) : (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              暂无可靠估价
            </Text>
          )}
          {refresh.error ? (
            <Text selectable style={{ color: colors.danger, ...typography.label }}>
              {refresh.error.message}
            </Text>
          ) : null}
          {asset.status !== 'sold' ? (
            <Pressable
              accessibilityRole="button"
              disabled={refresh.isPending}
              onPress={() => refresh.mutate()}
              style={({ pressed }) => ({
                alignItems: 'center',
                minHeight: 48,
                justifyContent: 'center',
                padding: spacing.md,
                borderRadius: radius.small,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                opacity: pressed || refresh.isPending ? 0.65 : 1,
              })}>
              {refresh.isPending ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <Text
                  style={{
                    ...typography.body,
                    color: colors.textPrimary,
                    fontWeight: '700',
                  }}>
                  刷新价格
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>

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
