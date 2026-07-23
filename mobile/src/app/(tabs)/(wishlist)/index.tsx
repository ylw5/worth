import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
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
                hitSlop={8}>
                <SymbolView
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={24}
                  tintColor={colors.green}
                />
              </Pressable>
            </Link>
          ),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 12 }}>
        {query.isLoading ? <LoadingState /> : null}
        {query.error ? <ErrorState message={query.error.message} /> : null}
        {deleteError ? <ErrorState message={deleteError} /> : null}
        {(query.data ?? []).map((item) => (
          <View
            key={item.id}
            style={{
              padding: 16,
              gap: 8,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: 12,
              }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text
                  selectable
                  style={{ color: colors.text, fontWeight: '700' }}>
                  {item.name}
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.green,
                    fontSize: 20,
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
                <Text style={{ color: colors.danger }}>删除</Text>
              </Pressable>
            </View>
            {item.notes ? (
              <Text selectable style={{ color: colors.muted }}>
                {item.notes}
              </Text>
            ) : null}
          </View>
        ))}
        {!query.isLoading && !query.error && !query.data?.length ? (
          <View
            style={{
              padding: 32,
              alignItems: 'center',
              gap: 12,
              backgroundColor: colors.card,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <Text selectable style={{ color: colors.text, fontWeight: '700' }}>
              还没有心愿
            </Text>
            <Link
              href="/(tabs)/(wishlist)/add"
              style={{ color: colors.green }}>
              添加第一个心愿
            </Link>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
