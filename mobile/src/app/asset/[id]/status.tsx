import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  assetStatusLabels,
  assetStatuses,
  type AssetStatus,
} from '@/lib/asset-status';
import { getAsset, setAssetStatus } from '@/lib/assets';

export default function AssetStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => getAsset(id),
    enabled: Boolean(id),
  });
  const mutation = useMutation({
    mutationFn: (status: Exclude<AssetStatus, 'sold'>) =>
      setAssetStatus(id, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['asset', id] }),
        queryClient.invalidateQueries({ queryKey: ['asset-sale', id] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
      router.back();
    },
  });

  if (assetQuery.isLoading) return <LoadingState />;
  if (assetQuery.error) return <ErrorState message={assetQuery.error.message} />;
  if (!assetQuery.data) return <ErrorState message="资产不存在" />;

  const asset = assetQuery.data;
  const choose = (status: AssetStatus) => {
    if (status === asset.status) {
      if (status === 'sold') {
        router.push({ pathname: '/asset/[id]/sale', params: { id } });
      }
      return;
    }
    if (status === 'sold') {
      router.push({ pathname: '/asset/[id]/sale', params: { id } });
      return;
    }
    if (asset.status === 'sold') {
      Alert.alert(
        '撤销已卖出？',
        '当前成交记录会被删除，状态流转记录仍会保留。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '撤销并切换',
            style: 'destructive',
            onPress: () => mutation.mutate(status),
          },
        ],
      );
      return;
    }
    mutation.mutate(status);
  };

  return (
    <>
      <Stack.Screen options={{ title: '物品状态' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }}>
        {assetStatuses.map((status) => {
          const selected = status === asset.status;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              disabled={mutation.isPending}
              key={status}
              onPress={() => choose(status)}
              style={({ pressed }) => ({
                minHeight: 52,
                padding: spacing.lg,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderRadius: radius.medium,
                borderCurve: 'continuous',
                backgroundColor: selected
                  ? colors.textPrimary
                  : colors.surface,
                opacity: pressed || mutation.isPending ? 0.65 : 1,
              })}>
              <Text
                style={{
                  ...typography.body,
                  color: selected ? colors.onDark : colors.textPrimary,
                  fontWeight: '600',
                }}>
                {assetStatusLabels[status]}
              </Text>
              {selected ? (
                <Text style={{ ...typography.label, color: colors.onDark }}>
                  当前
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        {mutation.isPending ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : null}
        {mutation.error ? (
          <View>
            <Text selectable style={{ color: colors.danger, ...typography.label }}>
              {mutation.error.message}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
