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

import { PurchaseDateField } from '@/components/purchase-date-field';
import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { getAssetSale, recordAssetSale } from '@/lib/assets';
import { parseSaleInput } from '@/lib/purchase-input';
import type { AssetSale } from '@/types/domain';

function AssetSaleForm({
  id,
  initialSale,
}: {
  id: string;
  initialSale: AssetSale | null;
}) {
  const queryClient = useQueryClient();
  const [soldAt, setSoldAt] = useState(initialSale?.sold_at ?? '');
  const [salePrice, setSalePrice] = useState(
    initialSale?.sale_price.toString() ?? '',
  );
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (input: { sold_at: string; sale_price: number }) =>
      recordAssetSale(id, input.sold_at, input.sale_price),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset', id] }),
        queryClient.invalidateQueries({ queryKey: ['asset-sale', id] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
      router.dismissTo({ pathname: '/asset/[id]', params: { id } });
    },
  });

  const submit = () => {
    const parsed = parseSaleInput(soldAt, salePrice);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError('');
    mutation.mutate(parsed.input);
  };

  return (
    <>
      <Stack.Screen options={{ title: '成交记录' }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
          <PurchaseDateField
            accessibilityLabel="选择成交日期"
            label="成交日期"
            value={soldAt}
            onChange={setSoldAt}
          />
          <View style={{ gap: spacing.sm }}>
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              成交价
            </Text>
            <TextInput
              accessibilityLabel="成交价"
              keyboardType="decimal-pad"
              onChangeText={setSalePrice}
              value={salePrice}
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
          {error || mutation.error ? (
            <Text selectable style={{ color: colors.danger, ...typography.label }}>
              {error || mutation.error?.message}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={mutation.isPending}
            onPress={submit}
            style={({ pressed }) => ({
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              padding: spacing.lg,
              borderRadius: radius.medium,
              borderCurve: 'continuous',
              backgroundColor: colors.textPrimary,
              opacity: pressed || mutation.isPending ? 0.65 : 1,
            })}>
            {mutation.isPending ? (
              <ActivityIndicator color={colors.onDark} />
            ) : (
              <Text
                style={{
                  color: colors.onDark,
                  ...typography.body,
                  fontWeight: '700',
                }}>
                保存成交记录
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function AssetSaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const saleQuery = useQuery({
    queryKey: ['asset-sale', id],
    queryFn: () => getAssetSale(id),
    enabled: Boolean(id),
  });

  if (saleQuery.isLoading) return <LoadingState />;
  if (saleQuery.error) return <ErrorState message={saleQuery.error.message} />;

  return <AssetSaleForm id={id} initialSale={saleQuery.data ?? null} />;
}
