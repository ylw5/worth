import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { listAssetSales, type AssetSaleWithName } from '@/lib/assets';
import { formatCurrency } from '@/lib/format';
import {
  buildAllocationPreview,
  getAllocatedAmount,
  getAvailableAmount,
  parseFulfillmentPrice,
  type SelectableFundingSource,
} from '@/lib/wishlist-allocations';
import {
  listConfirmedSpendingResolutions,
  type ConfirmedSpendingResolution,
} from '@/lib/spending-resolutions';
import {
  fulfillWishlistItem,
  listWishlistFundingAllocations,
  type WishlistFundingAllocation,
} from '@/lib/wishlist-fulfillment';
import { getWishlistItem } from '@/lib/wishlist';

type FundingSourceRow = SelectableFundingSource & {
  name: string;
  original_amount: number;
  allocated_amount: number;
};

function buildSources(
  resolutions: ConfirmedSpendingResolution[],
  sales: AssetSaleWithName[],
  allocations: WishlistFundingAllocation[],
): FundingSourceRow[] {
  const spending = resolutions.map((resolution) => {
    const allocated = getAllocatedAmount(
      allocations,
      'spending_resolution',
      resolution.id,
    );
    return {
      source_type: 'spending_resolution' as const,
      source_id: resolution.id,
      name: resolution.product_snapshot.title,
      original_amount: resolution.amount,
      allocated_amount: allocated,
      available_amount: getAvailableAmount(resolution.amount, allocated),
    };
  });
  const saleSources = sales.map((sale) => {
    const allocated = getAllocatedAmount(
      allocations,
      'asset_sale',
      sale.id,
    );
    return {
      source_type: 'asset_sale' as const,
      source_id: sale.id,
      name: sale.asset.name,
      original_amount: sale.sale_price,
      allocated_amount: allocated,
      available_amount: getAvailableAmount(sale.sale_price, allocated),
    };
  });
  return [...spending, ...saleSources].filter(
    (source) => source.available_amount > 0,
  );
}

const sourceKey = (source: SelectableFundingSource) =>
  `${source.source_type}:${source.source_id}`;

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.lg,
      }}>
      <Text
        selectable
        style={{ color: colors.textSecondary, ...typography.body }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          ...typography.body,
          fontWeight: '700',
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

export default function FulfillWishlistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const wishlistQuery = useQuery({
    queryKey: ['wishlist', id],
    queryFn: () => getWishlistItem(id),
    enabled: Boolean(id),
  });
  const resolutionsQuery = useQuery({
    queryKey: ['spending-resolutions', 'confirmed'],
    queryFn: listConfirmedSpendingResolutions,
  });
  const salesQuery = useQuery({
    queryKey: ['asset-sales'],
    queryFn: listAssetSales,
  });
  const allocationsQuery = useQuery({
    queryKey: ['wishlist-funding-allocations'],
    queryFn: listWishlistFundingAllocations,
  });
  const [actualPriceInput, setActualPrice] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [error, setError] = useState('');
  const actualPrice =
    actualPriceInput ?? String(wishlistQuery.data?.target_price ?? '');

  const sources = buildSources(
    resolutionsQuery.data ?? [],
    salesQuery.data ?? [],
    allocationsQuery.data ?? [],
  );
  const selectedSources = selectedKeys.flatMap((key) => {
    const source = sources.find((candidate) => sourceKey(candidate) === key);
    return source ? [source] : [];
  });
  const parsedPrice = parseFulfillmentPrice(actualPrice);
  const preview = buildAllocationPreview(
    'price' in parsedPrice ? parsedPrice.price : 0,
    selectedSources,
  );

  const fulfillMutation = useMutation({
    mutationFn: (input: {
      actualPrice: number;
      allocations: typeof preview.allocations;
    }) => fulfillWishlistItem(id, input.actualPrice, input.allocations),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
        queryClient.invalidateQueries({
          queryKey: ['wishlist-funding-allocations'],
        }),
      ]);
      router.back();
    },
    onError: async (caught) => {
      const message =
        caught instanceof Error ? caught.message : '实现心愿失败';
      setError(message);
      if (message === '资金余额已变化，请重新确认') {
        await allocationsQuery.refetch();
        setSelectedKeys([]);
      }
    },
  });

  const toggleSource = (source: FundingSourceRow) => {
    const key = sourceKey(source);
    setError('');
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key],
    );
  };

  const submit = () => {
    const parsed = parseFulfillmentPrice(actualPrice);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError('');
    fulfillMutation.mutate({
      actualPrice: parsed.price,
      allocations: buildAllocationPreview(
        parsed.price,
        selectedSources,
      ).allocations,
    });
  };

  const loading =
    wishlistQuery.isLoading ||
    resolutionsQuery.isLoading ||
    salesQuery.isLoading ||
    allocationsQuery.isLoading;
  const queryError =
    (!wishlistQuery.data && wishlistQuery.error) ||
    (!resolutionsQuery.data && resolutionsQuery.error) ||
    (!salesQuery.data && salesQuery.error) ||
    (!allocationsQuery.data && allocationsQuery.error);

  if (!id) {
    return (
      <>
        <Stack.Screen options={{ title: '实现心愿' }} />
        <ErrorState message="心愿不存在" />
      </>
    );
  }
  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: '实现心愿' }} />
        <LoadingState />
      </>
    );
  }
  if (queryError) {
    return (
      <>
        <Stack.Screen options={{ title: '实现心愿' }} />
        <ErrorState message={queryError.message} />
      </>
    );
  }
  if (!wishlistQuery.data) {
    return (
      <>
        <Stack.Screen options={{ title: '实现心愿' }} />
        <ErrorState message="心愿不存在" />
      </>
    );
  }

  const groups = [
    { type: 'spending_resolution' as const, title: '忍住消费' },
    { type: 'asset_sale' as const, title: '已卖闲置' },
  ];

  return (
    <>
      <Stack.Screen options={{ title: '实现心愿' }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
          <View style={{ gap: spacing.sm }}>
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              实际成交价
            </Text>
            <TextInput
              accessibilityLabel="实际成交价"
              editable={!fulfillMutation.isPending}
              keyboardType="decimal-pad"
              onChangeText={(value) => {
                setActualPrice(value);
                setError('');
              }}
              value={actualPrice}
              style={{
                minHeight: 48,
                color: colors.textPrimary,
                ...typography.body,
                padding: spacing.lg,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.small,
                borderCurve: 'continuous',
                backgroundColor: colors.surface,
              }}
            />
          </View>

          {groups.map((group) => {
            const groupSources = sources.filter(
              (source) => source.source_type === group.type,
            );
            return (
              <View key={group.type} style={{ gap: spacing.md }}>
                <Text
                  accessibilityRole="header"
                  selectable
                  style={{
                    color: colors.textPrimary,
                    ...typography.sectionTitle,
                  }}>
                  {group.title}
                </Text>
                {groupSources.length ? (
                  groupSources.map((source) => {
                    const key = sourceKey(source);
                    const selectedIndex = selectedKeys.indexOf(key);
                    const selected = selectedIndex >= 0;
                    const used =
                      preview.allocations.find(
                        (allocation) =>
                          allocation.source_type === source.source_type &&
                          allocation.source_id === source.source_id,
                      )?.amount ?? 0;
                    return (
                      <Pressable
                        accessibilityHint={
                          selected
                            ? '取消选择这笔资金'
                            : '选择这笔资金，按点击顺序抵扣'
                        }
                        accessibilityLabel={`${source.name}，原金额${formatCurrency(source.original_amount)}，已使用${formatCurrency(source.allocated_amount)}，可用${formatCurrency(source.available_amount)}${selected ? `，第${selectedIndex + 1}顺位，本次使用${formatCurrency(used)}` : ''}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: selected,
                          disabled: fulfillMutation.isPending,
                        }}
                        disabled={fulfillMutation.isPending}
                        key={key}
                        onPress={() => toggleSource(source)}
                        style={({ pressed }) => ({
                          padding: spacing.lg,
                          gap: spacing.sm,
                          borderWidth: 1,
                          borderColor: selected
                            ? colors.accent
                            : colors.border,
                          borderRadius: radius.medium,
                          borderCurve: 'continuous',
                          backgroundColor: selected
                            ? colors.accentSoft
                            : colors.surface,
                          opacity:
                            pressed || fulfillMutation.isPending ? 0.65 : 1,
                        })}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: spacing.md,
                          }}>
                          <View
                            style={{
                              width: 22,
                              height: 22,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: 1,
                              borderColor: selected
                                ? colors.accent
                                : colors.border,
                              borderRadius: 6,
                              backgroundColor: selected
                                ? colors.accent
                                : colors.surface,
                            }}>
                            {selected ? (
                              <Text
                                style={{
                                  color: colors.textPrimary,
                                  fontWeight: '800',
                                }}>
                                ✓
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            selectable
                            style={{
                              flex: 1,
                              color: colors.textPrimary,
                              ...typography.cardTitle,
                            }}>
                            {source.name}
                          </Text>
                        </View>
                        <Text
                          selectable
                          style={{
                            color: colors.textSecondary,
                            ...typography.label,
                            fontVariant: ['tabular-nums'],
                          }}>
                          原金额 {formatCurrency(source.original_amount)} · 已使用{' '}
                          {formatCurrency(source.allocated_amount)}
                        </Text>
                        <Text
                          selectable
                          style={{
                            color: colors.textPrimary,
                            ...typography.label,
                            fontVariant: ['tabular-nums'],
                          }}>
                          可用 {formatCurrency(source.available_amount)}
                        </Text>
                        {selected ? (
                          <Text
                            selectable
                            style={{
                              color: colors.textPrimary,
                              ...typography.label,
                              fontWeight: '700',
                              fontVariant: ['tabular-nums'],
                            }}>
                            第 {selectedIndex + 1} 顺位 · 本次使用{' '}
                            {formatCurrency(used)} · 剩余{' '}
                            {formatCurrency(
                              getAvailableAmount(
                                source.available_amount,
                                used,
                              ),
                            )}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })
                ) : (
                  <Text
                    selectable
                    style={{
                      color: colors.textSecondary,
                      ...typography.body,
                    }}>
                    没有可用记录
                  </Text>
                )}
              </View>
            );
          })}

          <View
            accessibilityRole="summary"
            style={{
              padding: spacing.lg,
              gap: spacing.md,
              borderRadius: radius.medium,
              borderCurve: 'continuous',
              backgroundColor: colors.surfaceMuted,
            }}>
            <SummaryRow
              label="实际成交价"
              value={'price' in parsedPrice ? parsedPrice.price : 0}
            />
            <SummaryRow label="资金抵扣" value={preview.funded_amount} />
            <SummaryRow label="自付金额" value={preview.self_paid_amount} />
            {'price' in parsedPrice && preview.funded_amount === 0 ? (
              <Text
                selectable
                style={{ color: colors.textSecondary, ...typography.label }}>
                未选择资金记录，将全额自付
              </Text>
            ) : null}
          </View>

          {error ? (
            <Text
              accessibilityRole="alert"
              selectable
              style={{ color: colors.danger, ...typography.body }}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={fulfillMutation.isPending}
            onPress={submit}
            style={({ pressed }) => ({
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              padding: spacing.lg,
              borderRadius: radius.medium,
              borderCurve: 'continuous',
              backgroundColor: colors.textPrimary,
              opacity: pressed || fulfillMutation.isPending ? 0.65 : 1,
            })}>
            {fulfillMutation.isPending ? (
              <ActivityIndicator color={colors.onDark} />
            ) : (
              <Text
                style={{
                  color: colors.onDark,
                  ...typography.body,
                  fontWeight: '700',
                }}>
                确认实现
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
