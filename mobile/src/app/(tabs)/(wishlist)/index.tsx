import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import { listConfirmedSpendingResolutionAmounts } from '@/lib/spending-resolutions';
import {
  deleteWishlistItem,
  listWishlistItems,
} from '@/lib/wishlist';
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
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }}>
        {query.isLoading || savingsQuery.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {savingsQuery.error ? (
          <ErrorState message={savingsQuery.error.message} />
        ) : null}
        {deleteError ? <ErrorState message={deleteError} /> : null}
        {!savingsQuery.isLoading && !savingsQuery.error
          ? (query.data ?? []).map((item) => {
              const progress = getWishlistProgress(
                savedAmount,
                item.target_price,
              );
              return (
                <View
                  key={item.id}
                  style={{
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
                        style={{ color: colors.danger, ...typography.label }}>
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
                      style={{
                        color: colors.textSecondary,
                        ...typography.body,
                      }}>
                      {item.notes}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
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
                    <Text style={{ color: colors.green, fontWeight: '700' }}>
                      查看今日卖出方案
                    </Text>
                  </Pressable>
                </View>
              );
            })
          : null}
        {!query.isLoading &&
        !query.error &&
        !savingsQuery.isLoading &&
        !savingsQuery.error &&
        !query.data?.length ? (
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
              还没有心愿
            </Text>
            <Link href="/(tabs)/(wishlist)/add" style={{ color: colors.accent }}>
              添加第一个心愿
            </Link>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
