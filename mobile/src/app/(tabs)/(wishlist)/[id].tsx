import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors } from '@/constants/colors';
import { estimateAsset, recommendSellPlan } from '@/lib/api';
import { recordValuation } from '@/lib/assets';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import {
  localDateKey,
  toSellPlanAssets,
} from '@/lib/sell-plan-helpers';
import {
  getDailySellPlan,
  listSellableAssetSources,
  listSellPlanHistory,
  saveDailySellPlan,
  type SellPlanAssetSource,
} from '@/lib/sell-plans';
import { getWishlistItem } from '@/lib/wishlist';
import { useSession } from '@/providers/session-provider';

export default function WishlistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [refreshProgress, setRefreshProgress] = useState('');

  const wishlist = useQuery({
    queryKey: ['wishlist', id],
    queryFn: () => getWishlistItem(id),
    enabled: Boolean(id),
  });
  const assets = useQuery({
    queryKey: ['sellable-assets'],
    queryFn: listSellableAssetSources,
  });
  const plan = useQuery({
    queryKey: ['sell-plan', id, localDateKey()],
    queryFn: async () => {
      const existing = await getDailySellPlan(id);
      if (existing) return existing;
      if (!session || !wishlist.data) {
        throw new Error('登录已失效，请重新登录');
      }
      const result = await recommendSellPlan(
        wishlist.data.target_price,
        toSellPlanAssets(assets.data ?? []),
      );
      return saveDailySellPlan(
        session.user.id,
        id,
        result,
      );
    },
    enabled: Boolean(
      id && session && wishlist.data && assets.data,
    ),
  });
  const history = useQuery({
    queryKey: ['sell-plan-history', id],
    queryFn: () => listSellPlanHistory(id),
    enabled: Boolean(id && plan.data),
  });

  const refresh = useMutation({
    mutationFn: async () => {
      if (!session || !wishlist.data) {
        throw new Error('登录已失效，请重新登录');
      }
      const current = assets.data ?? [];
      const updated: SellPlanAssetSource[] = [];
      let failures = 0;

      for (const [index, asset] of current.entries()) {
        setRefreshProgress(`正在更新 ${index + 1}/${current.length} 件`);
        try {
          const valuation = await estimateAsset(asset);
          if (
            valuation.estimated_price === null ||
            valuation.price_low === null ||
            valuation.price_high === null
          ) {
            failures += 1;
            updated.push(asset);
            continue;
          }
          await recordValuation(asset.id, valuation);
          updated.push({
            ...asset,
            latest_market_price: valuation.estimated_price,
            latest_market_price_low: valuation.price_low,
            latest_market_price_high: valuation.price_high,
            latest_valuation_at: new Date().toISOString(),
          });
        } catch {
          failures += 1;
          updated.push(asset);
        }
      }

      setRefreshProgress('正在重新计算方案');
      const result = await recommendSellPlan(
        wishlist.data.target_price,
        toSellPlanAssets(updated),
      );
      return saveDailySellPlan(session.user.id, id, result, failures);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['sellable-assets'] }),
        queryClient.invalidateQueries({ queryKey: ['sell-plan', id] }),
        queryClient.invalidateQueries({ queryKey: ['sell-plan-history', id] }),
      ]);
    },
    onSettled: () => setRefreshProgress(''),
  });

  if (wishlist.isLoading) return <LoadingState />;
  if (wishlist.error) return <ErrorState message={wishlist.error.message} />;
  if (!wishlist.data) return <ErrorState message="心愿不存在" />;

  const item = wishlist.data;
  const currentPlan = plan.data;
  return (
    <>
      <Stack.Screen options={{ title: item.name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 18 }}>
        <View
          style={{
            padding: 18,
            gap: 8,
            backgroundColor: colors.card,
            borderRadius: 18,
            borderCurve: 'continuous',
          }}>
          <Text selectable style={{ color: colors.muted }}>
            心愿目标
          </Text>
          <Text
            selectable
            style={{ color: colors.text, fontSize: 23, fontWeight: '800' }}>
            {item.name}
          </Text>
          <Text
            selectable
            style={{ color: colors.green, fontSize: 32, fontWeight: '800' }}>
            {formatCurrency(item.target_price)}
          </Text>
          {item.notes ? (
            <Text selectable style={{ color: colors.muted }}>
              {item.notes}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            padding: 18,
            gap: 14,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            borderCurve: 'continuous',
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}>
            <Text selectable style={{ color: colors.text, fontWeight: '800' }}>
              今日最佳卖出组合
            </Text>
            <Text selectable style={{ color: colors.muted, fontSize: 12 }}>
              {localDateKey()}
            </Text>
          </View>

          {plan.isLoading ? <LoadingState /> : null}
          {assets.error ? (
            <ErrorState message={assets.error.message} />
          ) : null}
          {plan.error ? <ErrorState message={plan.error.message} /> : null}
          {currentPlan ? (
            <>
              <View style={{ gap: 8 }}>
                {currentPlan.items.map((asset) => (
                  <View
                    key={asset.id}
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}>
                    <Text
                      selectable
                      style={{ flex: 1, color: colors.text }}>
                      {asset.name}
                    </Text>
                    <Text
                      selectable
                      style={{
                        color: colors.green,
                        fontVariant: ['tabular-nums'],
                      }}>
                      {formatCurrency(asset.conservative_price)}
                    </Text>
                  </View>
                ))}
                {!currentPlan.items.length ? (
                  <Text selectable style={{ color: colors.muted }}>
                    暂无已估价的闲置或已上架资产
                  </Text>
                ) : null}
              </View>
              <View
                style={{
                  height: 9,
                  overflow: 'hidden',
                  backgroundColor: colors.greenSoft,
                  borderRadius: 99,
                }}>
                <View
                  style={{
                    width: `${Math.min(
                      100,
                      currentPlan.coverage_ratio * 100,
                    )}%`,
                    height: '100%',
                    backgroundColor: colors.green,
                  }}
                />
              </View>
              <Text selectable style={{ color: colors.text, lineHeight: 21 }}>
                预计 {formatCurrency(currentPlan.estimated_total)}，
                {currentPlan.is_reachable
                  ? '可以覆盖当前目标。'
                  : `可覆盖目标的 ${Math.round(
                      currentPlan.coverage_ratio * 100,
                    )}%。`}
              </Text>
              {currentPlan.refresh_failures ? (
                <Text selectable style={{ color: colors.danger }}>
                  {currentPlan.refresh_failures} 件资产行情刷新失败，方案使用最近一次估值。
                </Text>
              ) : null}
            </>
          ) : null}

          {refresh.error ? (
            <ErrorState message={refresh.error.message} />
          ) : null}
          {refreshProgress ? (
            <Text selectable style={{ color: colors.muted }}>
              {refreshProgress}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={
              refresh.isPending || assets.isLoading || Boolean(assets.error)
            }
            onPress={() => refresh.mutate()}
            style={({ pressed }) => ({
              padding: 13,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.green,
              borderRadius: 13,
              borderCurve: 'continuous',
              opacity:
                pressed ||
                refresh.isPending ||
                assets.isLoading ||
                Boolean(assets.error)
                  ? 0.6
                  : 1,
            })}>
            {refresh.isPending ? (
              <ActivityIndicator color={colors.green} />
            ) : (
              <Text style={{ color: colors.green, fontWeight: '700' }}>
                刷新行情与方案
              </Text>
            )}
          </Pressable>
        </View>

        <View style={{ gap: 11 }}>
          <Text selectable style={{ color: colors.text, fontWeight: '800' }}>
            历史方案
          </Text>
          {history.isLoading ? <LoadingState /> : null}
          {history.error ? (
            <ErrorState message={history.error.message} />
          ) : null}
          {(history.data ?? []).map((snapshot) => (
            <View
              key={snapshot.id}
              style={{
                padding: 15,
                gap: 6,
                backgroundColor: colors.card,
                borderRadius: 15,
                borderCurve: 'continuous',
              }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                <Text selectable style={{ color: colors.muted }}>
                  {formatDateOnly(snapshot.plan_date)}
                </Text>
                <Text
                  selectable
                  style={{ color: colors.green, fontWeight: '700' }}>
                  {formatCurrency(snapshot.estimated_total)}
                </Text>
              </View>
              <Text selectable style={{ color: colors.text }}>
                {snapshot.items.map((asset) => asset.name).join(' + ') ||
                  '无可推荐资产'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}
