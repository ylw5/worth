import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import {
  deleteWishlistItem,
  listWishlistItems,
} from '@/lib/wishlist';

export default function WishlistScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['wishlist'],
    queryFn: listWishlistItems,
  });
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
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {deleteError ? <ErrorState message={deleteError} /> : null}
        {(query.data ?? []).map((item) => (
          <View
            key={item.id}
            style={{
              padding: spacing.lg,
              gap: spacing.sm,
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
              <View style={{ flex: 1, gap: spacing.sm }}>
                <Text
                  selectable
                  style={{ color: colors.textPrimary, ...typography.cardTitle }}>
                  {item.name}
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.textPrimary,
                    fontSize: 20,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                  }}>
                  {formatCurrency(item.target_price)}
                </Text>
              </View>
              <Pressable
                accessibilityLabel={`删除${item.name}`}
                accessibilityRole="button"
                disabled={deletingId === item.id}
                hitSlop={8}
                onPress={() => confirmDelete(item.id, item.name)}>
                <Text style={{ color: colors.danger, ...typography.label }}>
                  删除
                </Text>
              </Pressable>
            </View>
            {item.notes ? (
              <Text
                selectable
                style={{ color: colors.textSecondary, ...typography.body }}>
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
        ))}
        {!query.isLoading && !query.error && !query.data?.length ? (
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
