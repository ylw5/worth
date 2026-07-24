import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AssetCard } from '@/components/asset-card';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { getAssetGridColumns } from '@/lib/asset-grid';
import {
  assetStatusLabels,
  assetStatuses,
  isCurrentAsset,
  matchesAssetFilters,
  type AssetStatus,
} from '@/lib/asset-status';
import { listAssets } from '@/lib/assets';
import { formatCurrency } from '@/lib/format';

const gridGap = spacing.lg;
const pagePadding = spacing.xl;

export default function AssetsScreen() {
  const { width } = useWindowDimensions();
  const columns = getAssetGridColumns(width);
  const cardWidth =
    (width - pagePadding * 2 - gridGap * (columns - 1)) / columns;
  const query = useQuery({ queryKey: ['assets'], queryFn: listAssets });
  const assets = useMemo(() => query.data ?? [], [query.data]);
  const currentAssets = useMemo(
    () => assets.filter(isCurrentAsset),
    [assets],
  );
  const [selectedStatus, setSelectedStatus] = useState<AssetStatus | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const total = currentAssets.reduce(
    (sum, asset) => sum + (asset.latest_market_price ?? 0),
    0,
  );
  const pending = currentAssets.filter(
    (asset) => asset.latest_market_price === null,
  ).length;
  const sold = assets.length - currentAssets.length;

  const categories = useMemo(
    () =>
      Object.keys(
        assets.reduce<Record<string, true>>((result, asset) => {
          result[asset.category] = true;
          return result;
        }, {}),
      ).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [assets],
  );

  const filteredAssets = assets.filter((asset) =>
    matchesAssetFilters(asset, selectedStatus, selectedCategory),
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: '我的资产',
          headerLargeTitle: true,
          headerRight: () => (
            <Link href="/capture" asChild>
              <Pressable
                accessibilityLabel="添加物品"
                accessibilityRole="button"
                hitSlop={8}
                style={{
                  width: 44,
                  height: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <SymbolView
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={24}
                  tintColor={colors.textPrimary}
                />
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          padding: pagePadding,
          gap: spacing.xxl,
        }}>
        <View style={{ gap: spacing.sm }}>
          <Text
            selectable
            style={{ color: colors.textSecondary, ...typography.label }}>
            总资产参考价值
          </Text>
          <Text
            selectable
            style={{
              color: colors.textPrimary,
              ...typography.display,
              fontVariant: ['tabular-nums'],
            }}>
            {formatCurrency(total)}
          </Text>
          <Text
            selectable
            style={{ color: colors.textSecondary, ...typography.label }}>
            {currentAssets.length} 件当前资产 · {sold} 件已卖出 · {pending}{' '}
            件待估价
          </Text>
        </View>

        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}

        <View style={{ gap: spacing.md }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              gap: spacing.xl,
              alignItems: 'flex-end',
            }}>
            {(
              [
                { value: null, label: '全部' },
                ...assetStatuses.map((status) => ({
                  value: status,
                  label: assetStatusLabels[status],
                })),
              ] as const
            ).map((tab) => {
              const selected = selectedStatus === tab.value;
              return (
                <Pressable
                  key={tab.label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setSelectedStatus(tab.value)}
                  style={{
                    paddingBottom: spacing.sm,
                    borderBottomWidth: 2,
                    borderBottomColor: selected
                      ? colors.textPrimary
                      : 'transparent',
                  }}>
                  <Text
                    style={{
                      color: selected
                        ? colors.textPrimary
                        : colors.textSecondary,
                      ...typography.label,
                      fontWeight: selected ? '700' : '400',
                    }}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {categories.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: spacing.xl,
                alignItems: 'center',
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: selectedCategory === null }}
                onPress={() => setSelectedCategory(null)}
                style={{
                  height: 28,
                  paddingHorizontal:
                    selectedCategory === null ? spacing.md : 0,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor:
                    selectedCategory === null
                      ? colors.textPrimary
                      : 'transparent',
                }}>
                <Text
                  style={{
                    color:
                      selectedCategory === null
                        ? colors.onDark
                        : colors.textSecondary,
                    ...typography.label,
                  }}>
                  全部
                </Text>
              </Pressable>
              {categories.map((category) => {
                const selected = selectedCategory === category;
                return (
                  <Pressable
                    key={category}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setSelectedCategory(category)}
                    style={{
                      height: 28,
                      paddingHorizontal: selected ? spacing.md : 0,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected
                        ? colors.textPrimary
                        : 'transparent',
                    }}>
                    <Text
                      style={{
                        color: selected
                          ? colors.onDark
                          : colors.textSecondary,
                        ...typography.label,
                      }}>
                      {category}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>

        <View style={{ gap: spacing.md }}>
          {!query.isLoading && !filteredAssets.length ? (
            <View
              style={{
                padding: spacing.xxxl,
                alignItems: 'center',
                gap: spacing.md,
                backgroundColor: colors.surface,
                borderRadius: radius.large,
                borderCurve: 'continuous',
              }}>
              <Text
                selectable
                style={{ color: colors.textPrimary, ...typography.sectionTitle }}>
                {assets.length ? '该筛选下暂无资产' : '还没有资产'}
              </Text>
              {!assets.length ? (
                <Link href="/capture" style={{ color: colors.accent }}>
                  拍下第一件物品
                </Link>
              ) : null}
            </View>
          ) : (
            <View
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gridGap }}>
              {filteredAssets.map((asset) => (
                <View key={asset.id} style={{ width: cardWidth }}>
                  <AssetCard asset={asset} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}
