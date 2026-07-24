import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import { listConfirmedSpendingResolutionAmounts } from '@/lib/spending-resolutions';
import {
  deleteWishlistItem,
  listWishlistItems,
} from '@/lib/wishlist';
import {
  getWishlistCarouselIndex,
  getWishlistCarouselMetrics,
} from '@/lib/wishlist-carousel';
import {
  getWishlistProgress,
  sumSavings,
} from '@/lib/wishlist-progress';

export default function WishlistScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: listWishlistItems,
  });
  const savingsQuery = useQuery({
    queryKey: ['spending-resolutions', 'confirmed-amounts'],
    queryFn: listConfirmedSpendingResolutionAmounts,
  });
  const savedAmount = sumSavings(savingsQuery.data ?? []);
  const refetchSavings = savingsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchSavings();
    }, [refetchSavings]),
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const { width: screenWidth } = useWindowDimensions();
  const { cardWidth, gap, sidePadding, snapInterval } =
    getWishlistCarouselMetrics(screenWidth, { gap: spacing.md });
  const items = query.data ?? [];
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= items.length && items.length > 0) {
      setActiveIndex(items.length - 1);
    }
  }, [activeIndex, items.length]);

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
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
          {query.isLoading || savingsQuery.isLoading ? <LoadingState /> : null}
          {query.error ? <ErrorState message={query.error.message} /> : null}
          {savingsQuery.error ? (
            <ErrorState message={savingsQuery.error.message} />
          ) : null}
          {deleteError ? <ErrorState message={deleteError} /> : null}
        </View>
        {!query.isLoading &&
        !query.error &&
        !savingsQuery.isLoading &&
        !savingsQuery.error &&
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
        {!savingsQuery.isLoading && !savingsQuery.error && items.length > 0 ? (
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
              renderItem={({ item, index }) => {
                const progress = getWishlistProgress(
                  savedAmount,
                  item.target_price,
                );
                return (
                  <View
                    style={{
                      width: cardWidth,
                      marginRight: index === items.length - 1 ? 0 : gap,
                      padding: spacing.lg,
                      gap: spacing.md,
                      backgroundColor: colors.surface,
                      borderRadius: radius.large,
                      borderCurve: 'continuous',
                    }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        gap: spacing.md,
                      }}>
                      <Text
                        selectable
                        style={{
                          flex: 1,
                          color: colors.textSecondary,
                          ...typography.cardTitle,
                        }}>
                        {item.name}
                      </Text>
                      <Pressable
                        accessibilityLabel={`删除${item.name}`}
                        accessibilityRole="button"
                        disabled={deletingId === item.id}
                        hitSlop={8}
                        onPress={() => confirmDelete(item.id, item.name)}>
                        <Text
                          style={{
                            color: colors.danger,
                            ...typography.label,
                          }}>
                          删除
                        </Text>
                      </Pressable>
                    </View>
                    <Text
                      selectable
                      style={{
                        color: colors.textPrimary,
                        fontSize: 34,
                        fontWeight: '700',
                        fontVariant: ['tabular-nums'],
                      }}>
                      {formatCurrency(savedAmount)} /{' '}
                      {item.target_price.toLocaleString('zh-CN', {
                        maximumFractionDigits: 0,
                      })}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.md,
                      }}>
                      <View
                        accessibilityLabel={`${item.name}心愿进度`}
                        accessibilityRole="progressbar"
                        accessibilityValue={{
                          min: 0,
                          max: 100,
                          now: progress.barPercentage,
                          text: `${progress.percentage}%`,
                        }}
                        style={{
                          flex: 1,
                          height: 12,
                          overflow: 'hidden',
                          backgroundColor: colors.surfaceMuted,
                          borderRadius: radius.pill,
                        }}>
                        <View
                          style={{
                            width: `${progress.barPercentage}%`,
                            height: '100%',
                            backgroundColor: colors.accent,
                            borderRadius: radius.pill,
                          }}
                        />
                      </View>
                      <Text
                        selectable
                        style={{
                          minWidth: 44,
                          color: colors.textPrimary,
                          fontSize: 18,
                          fontWeight: '700',
                          fontVariant: ['tabular-nums'],
                        }}>
                        {progress.percentage}%
                      </Text>
                    </View>
                    {item.notes ? (
                      <Text
                        selectable
                        numberOfLines={3}
                        style={{
                          color: colors.textSecondary,
                          ...typography.body,
                        }}>
                        {item.notes}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`查看${item.name}今日卖出方案`}
                      onPress={() =>
                        router.push({
                          pathname: '/(tabs)/(wishlist)/[id]',
                          params: { id: item.id },
                        })
                      }
                      style={({ pressed }) => ({
                        alignSelf: 'flex-start',
                        paddingVertical: 5,
                        opacity: pressed ? 0.6 : 1,
                      })}>
                      <Text
                        style={{ color: colors.green, fontWeight: '700' }}>
                        查看今日卖出方案
                      </Text>
                    </Pressable>
                  </View>
                );
              }}
            />
            {items.length > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: spacing.sm,
                  paddingBottom: spacing.xl,
                }}>
                {items.map((item, index) => (
                  <View
                    key={item.id}
                    accessibilityLabel={
                      index === activeIndex
                        ? `第${index + 1}张，当前`
                        : `第${index + 1}张`
                    }
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: radius.pill,
                      backgroundColor:
                        index === activeIndex ? colors.accent : colors.border,
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
}
