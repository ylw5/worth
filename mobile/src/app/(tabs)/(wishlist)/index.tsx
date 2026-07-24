import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { WishlistCard } from '@/components/wishlist-card';
import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  listAssetSales,
  type AssetSaleWithName,
} from '@/lib/assets';
import { formatCurrency, formatDate, formatDateOnly } from '@/lib/format';
import {
  listConfirmedSpendingResolutions,
  type ConfirmedSpendingResolution,
} from '@/lib/spending-resolutions';
import {
  deleteWishlistItem,
  listWishlistItems,
} from '@/lib/wishlist';
import {
  getWishlistCarouselIndex,
  getWishlistCarouselMetrics,
} from '@/lib/wishlist-carousel';
import { sumAmounts } from '@/lib/wishlist-progress';

type FundingTab = 'spending' | 'sales';

function WishlistFundingDetails({
  resolutions,
  sales,
}: {
  resolutions: ConfirmedSpendingResolution[];
  sales: AssetSaleWithName[];
}) {
  const [activeTab, setActiveTab] = useState<FundingTab>('spending');
  const spendingTotal = sumAmounts(
    resolutions.map((resolution) => resolution.amount),
  );
  const salesTotal = sumAmounts(sales.map((sale) => sale.sale_price));
  const tabs: { key: FundingTab; label: string }[] = [
    { key: 'spending', label: '忍住消费' },
    { key: 'sales', label: '已卖闲置' },
  ];
  const activeTotal =
    activeTab === 'spending' ? spendingTotal : salesTotal;

  return (
    <View
      style={{
        marginHorizontal: spacing.xl,
        padding: spacing.lg,
        gap: spacing.lg,
        backgroundColor: colors.surface,
        borderRadius: radius.large,
        borderCurve: 'continuous',
      }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}>
        {tabs.map((tab) => {
          const selected = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomWidth: 2,
                borderBottomColor: selected
                  ? colors.accent
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
      </View>

      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          style={{ color: colors.textSecondary, ...typography.label }}>
          累计金额
        </Text>
        <Text
          selectable
          style={{
            color: colors.textPrimary,
            ...typography.sectionTitle,
            fontVariant: ['tabular-nums'],
          }}>
          {formatCurrency(activeTotal)}
        </Text>
      </View>

      <View style={{ gap: spacing.md }}>
        {activeTab === 'spending' ? (
          resolutions.length ? (
            resolutions.map((resolution) => (
              <View
                key={resolution.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                  paddingVertical: spacing.sm,
                }}>
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text
                    selectable
                    numberOfLines={2}
                    style={{
                      color: colors.textPrimary,
                      ...typography.body,
                    }}>
                    {resolution.product_snapshot.title}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.textSecondary,
                      ...typography.caption,
                    }}>
                    {formatDate(resolution.confirmed_at)}
                  </Text>
                </View>
                <Text
                  selectable
                  style={{
                    color: colors.textPrimary,
                    ...typography.body,
                    fontWeight: '600',
                    fontVariant: ['tabular-nums'],
                  }}>
                  {formatCurrency(resolution.amount)}
                </Text>
              </View>
            ))
          ) : (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.body }}>
              还没有忍住消费记录
            </Text>
          )
        ) : sales.length ? (
          sales.map((sale) => (
            <View
              key={sale.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: spacing.md,
                paddingVertical: spacing.sm,
              }}>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text
                  selectable
                  numberOfLines={2}
                  style={{
                    color: colors.textPrimary,
                    ...typography.body,
                  }}>
                  {sale.asset.name}
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.textSecondary,
                    ...typography.caption,
                  }}>
                  {formatDateOnly(sale.sold_at)}
                </Text>
              </View>
              <Text
                selectable
                style={{
                  color: colors.textPrimary,
                  ...typography.body,
                  fontWeight: '600',
                  fontVariant: ['tabular-nums'],
                }}>
                {formatCurrency(sale.sale_price)}
              </Text>
            </View>
          ))
        ) : (
          <Text
            selectable
            style={{ color: colors.textSecondary, ...typography.body }}>
            还没有已卖闲置记录
          </Text>
        )}
      </View>
    </View>
  );
}

export default function WishlistScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: listWishlistItems,
  });
  const resolutionsQuery = useQuery({
    queryKey: ['spending-resolutions', 'confirmed'],
    queryFn: listConfirmedSpendingResolutions,
  });
  const salesQuery = useQuery({
    queryKey: ['asset-sales'],
    queryFn: listAssetSales,
  });
  const resolutions = resolutionsQuery.data ?? [];
  const sales = salesQuery.data ?? [];
  const spendingTotal = sumAmounts(
    resolutions.map((resolution) => resolution.amount),
  );
  const salesTotal = sumAmounts(sales.map((sale) => sale.sale_price));
  const fundedAmount = spendingTotal + salesTotal;
  const refetchResolutions = resolutionsQuery.refetch;
  const refetchSales = salesQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      void Promise.all([refetchResolutions(), refetchSales()]);
    }, [refetchResolutions, refetchSales]),
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const { width: screenWidth } = useWindowDimensions();
  const { cardWidth, gap, sidePadding, snapInterval } =
    getWishlistCarouselMetrics(screenWidth, { gap: spacing.md });
  const items = query.data ?? [];
  const fundingLoading = resolutionsQuery.isLoading || salesQuery.isLoading;
  const fundingError = resolutionsQuery.error ?? salesQuery.error;
  const [activeIndex, setActiveIndex] = useState(0);
  const visibleActiveIndex = Math.min(
    activeIndex,
    Math.max(items.length - 1, 0),
  );

  const onCarouselScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      setActiveIndex(
        getWishlistCarouselIndex(
          event.nativeEvent.contentOffset.x,
          snapInterval,
          items.length,
        ),
      );
    },
    [items.length, snapInterval],
  );

  const confirmDelete = (id: string, name: string) => {
    Alert.alert('删除心愿', `确定删除“${name}”吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(id);
          setDeleteError('');
          try {
            await deleteWishlistItem(id);
            await queryClient.invalidateQueries({ queryKey: ['wishlist'] });
          } catch (caught) {
            setDeleteError(
              caught instanceof Error ? caught.message : '删除失败',
            );
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: '心愿单',
          headerLargeTitle: true,
          headerRight: () => (
            <Link href="/(tabs)/(wishlist)/add" asChild>
              <Pressable
                accessibilityLabel="添加心愿"
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
      {/* ponytail: ScrollView is enough for personal history; paginate with a vertical FlatList only when record counts make rendering measurable. */}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
          {query.isLoading || fundingLoading ? <LoadingState /> : null}
          {query.error ? <ErrorState message={query.error.message} /> : null}
          {fundingError ? <ErrorState message={fundingError.message} /> : null}
          {deleteError ? <ErrorState message={deleteError} /> : null}
        </View>
        {!query.isLoading &&
        !query.error &&
        !fundingLoading &&
        !fundingError &&
        items.length === 0 ? (
          <View style={{ padding: spacing.xl }}>
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
                style={{
                  color: colors.textPrimary,
                  ...typography.sectionTitle,
                }}>
                还没有心愿
              </Text>
              <Link
                href="/(tabs)/(wishlist)/add"
                style={{ color: colors.accent }}>
                添加第一个心愿
              </Link>
            </View>
          </View>
        ) : null}
        {!fundingLoading && !fundingError && items.length > 0 ? (
          <View
            style={{ flexGrow: 0, paddingTop: spacing.xl, gap: spacing.lg }}>
            <FlatList
              horizontal
              data={items}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={snapInterval}
              snapToAlignment="start"
              disableIntervalMomentum
              contentContainerStyle={{
                paddingHorizontal: sidePadding,
              }}
              onMomentumScrollEnd={onCarouselScrollEnd}
              renderItem={({ item, index }) => (
                <WishlistCard
                  item={item}
                  fundedAmount={fundedAmount}
                  deleting={deletingId === item.id}
                  onDelete={confirmDelete}
                  style={{
                    width: cardWidth,
                    marginRight: index === items.length - 1 ? 0 : gap,
                  }}
                />
              )}
            />
            {items.length > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: spacing.sm,
                }}>
                {items.map((item, index) => (
                  <View
                    key={item.id}
                    accessibilityLabel={
                      index === visibleActiveIndex
                        ? `第${index + 1}张，当前`
                        : `第${index + 1}张`
                    }
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: radius.pill,
                      backgroundColor:
                        index === visibleActiveIndex
                          ? colors.accent
                          : colors.border,
                    }}
                  />
                ))}
              </View>
            ) : null}
            <WishlistFundingDetails
              resolutions={resolutions}
              sales={sales}
            />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
