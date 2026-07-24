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
import { prepareSellPlan } from '@/lib/api';
import { confirmAssetSellability } from '@/lib/assets';
import { formatCurrency, formatDateOnly } from '@/lib/format';
import { localDateKey } from '@/lib/sell-plan-helpers';
import {
  listSellPlanHistory,
  type SellPlanReadinessItem,
} from '@/lib/sell-plans';
import { getWishlistItem } from '@/lib/wishlist';
import type { AssetStatus } from '@/types/domain';

type ConfirmableStatus = Exclude<AssetStatus, 'sold'>;

const confirmationOptions: {
  status: ConfirmableStatus;
  label: string;
}[] = [
  { status: 'in_use', label: '还在用' },
  { status: 'idle', label: '已闲置' },
  { status: 'listed', label: '准备出售' },
];

function ReadinessMetric({
  label,
  value,
  color = colors.text,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 3 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 12 }}>
        {label}
      </Text>
      <Text
        selectable
        style={{ color, fontSize: 18, fontWeight: '800' }}>
        {value}
      </Text>
    </View>
  );
}

function ConfirmationRow({
  asset,
  selected,
  disabled,
  onSelect,
}: {
  asset: SellPlanReadinessItem;
  selected?: ConfirmableStatus;
  disabled: boolean;
  onSelect: (status: ConfirmableStatus) => void;
}) {
  return (
    <View
      style={{
        padding: 13,
        gap: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 14,
        borderCurve: 'continuous',
      }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 12,
        }}>
        <Text
          selectable
          numberOfLines={1}
          style={{ flex: 1, color: colors.text, fontWeight: '700' }}>
          {asset.name}
        </Text>
        {asset.conservative_price ? (
          <Text selectable style={{ color: colors.green }}>
            参考 {formatCurrency(asset.conservative_price)}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {confirmationOptions.map((option) => {
          const active = selected === option.status;
          return (
            <Pressable
              key={option.status}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              disabled={disabled}
              onPress={() => onSelect(option.status)}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 9,
                alignItems: 'center',
                borderRadius: 10,
                borderCurve: 'continuous',
                backgroundColor: active ? colors.text : colors.greenSoft,
                opacity: pressed || disabled ? 0.65 : 1,
              })}>
              <Text
                style={{
                  color: active ? colors.card : colors.text,
                  fontSize: 12,
                  fontWeight: '700',
                }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function WishlistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const dateKey = localDateKey();
  const [confirmations, setConfirmations] = useState<
    Record<string, ConfirmableStatus>
  >({});

  const wishlist = useQuery({
    queryKey: ['wishlist', id],
    queryFn: () => getWishlistItem(id),
    enabled: Boolean(id),
  });
  const prepared = useQuery({
    queryKey: ['sell-plan-prepared', id, dateKey],
    queryFn: () => prepareSellPlan(id, dateKey),
    enabled: Boolean(id),
  });
  const history = useQuery({
    queryKey: ['sell-plan-history', id],
    queryFn: () => listSellPlanHistory(id),
    enabled: Boolean(id && prepared.data),
  });

  const confirm = useMutation({
    mutationFn: () =>
      confirmAssetSellability(
        Object.entries(confirmations).map(([assetId, status]) => ({
          id: assetId,
          status,
        })),
      ),
    onSuccess: async () => {
      setConfirmations({});
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['sell-plan-prepared', id],
        }),
        queryClient.invalidateQueries({ queryKey: ['sell-plan-assets'] }),
        queryClient.invalidateQueries({ queryKey: ['sell-plan', id] }),
        queryClient.invalidateQueries({
          queryKey: ['sell-plan-history', id],
        }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
    },
  });
  const refresh = useMutation({
    mutationFn: () => prepareSellPlan(id, dateKey, true),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        ['sell-plan-prepared', id, dateKey],
        result,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
        queryClient.invalidateQueries({ queryKey: ['sell-plan-assets'] }),
        queryClient.invalidateQueries({
          queryKey: ['sell-plan-history', id],
        }),
      ]);
    },
  });

  if (wishlist.isLoading) return <LoadingState />;
  if (wishlist.error) return <ErrorState message={wishlist.error.message} />;
  if (!wishlist.data) return <ErrorState message="心愿不存在" />;

  const item = wishlist.data;
  const result = prepared.data;
  const needsConfirmation =
    result?.readiness.filter(
      (asset) => asset.readiness === 'needs_confirmation',
    ) ?? [];
  const selectedCount = Object.keys(confirmations).length;
  const refreshableCount = result
    ? result.readiness_counts.ready +
      result.readiness_counts.needs_valuation +
      result.readiness_counts.stale_valuation
    : 0;
  const reasons = new Map(
    result?.explanation.item_reasons.map((reason) => [
      reason.item_id,
      reason.reason,
    ]),
  );

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
              {dateKey}
            </Text>
          </View>

          {prepared.isLoading ? <LoadingState /> : null}
          {prepared.error ? (
            <ErrorState message={prepared.error.message} />
          ) : null}
          {result ? (
            <>
              <Text
                selectable
                style={{ color: colors.text, lineHeight: 21 }}>
                {result.explanation.summary}
              </Text>
              <View style={{ gap: 10 }}>
                {result.plan.items.map((asset) => (
                  <View key={asset.id} style={{ gap: 3 }}>
                    <View
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
                    {reasons.get(asset.id) ? (
                      <Text
                        selectable
                        style={{
                          color: colors.muted,
                          fontSize: 12,
                          lineHeight: 18,
                        }}>
                        {reasons.get(asset.id)}
                      </Text>
                    ) : null}
                  </View>
                ))}
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
                      result.plan.coverage_ratio * 100,
                    )}%`,
                    height: '100%',
                    backgroundColor: colors.green,
                  }}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <View
                  style={{
                    flex: 1,
                    padding: 12,
                    gap: 4,
                    backgroundColor: colors.greenSoft,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                  }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    已确认可卖
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.green,
                      fontSize: 18,
                      fontWeight: '800',
                    }}>
                    {formatCurrency(result.confirmed_sellable_total)}
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    padding: 12,
                    gap: 4,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    borderCurve: 'continuous',
                  }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    待确认潜力
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.text,
                      fontSize: 18,
                      fontWeight: '800',
                    }}>
                    {formatCurrency(result.unconfirmed_potential_total)}
                  </Text>
                </View>
              </View>
              {result.refresh_failures ? (
                <Text selectable style={{ color: colors.danger }}>
                  {result.refresh_failures}{' '}
                  件资产行情刷新失败；原估价仍有效时才会保留在组合中。
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        {result ? (
          <View
            style={{
              padding: 18,
              gap: 14,
              backgroundColor: colors.card,
              borderRadius: 18,
              borderCurve: 'continuous',
            }}>
            <Text selectable style={{ color: colors.text, fontWeight: '800' }}>
              数据就绪
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <ReadinessMetric
                label="可计算"
                value={result.readiness_counts.ready}
                color={colors.green}
              />
              <ReadinessMetric
                label="待确认"
                value={result.readiness_counts.needs_confirmation}
              />
              <ReadinessMetric
                label="待估价"
                value={
                  result.readiness_counts.needs_valuation +
                  result.readiness_counts.stale_valuation
                }
              />
              <ReadinessMetric
                label="继续持有"
                value={result.readiness_counts.excluded}
              />
            </View>

            {needsConfirmation.length ? (
              <>
                <Text
                  selectable
                  style={{ color: colors.muted, lineHeight: 20 }}>
                  先确认当前状态。只有“已闲置”和“准备出售”会进入估价与组合。
                </Text>
                {needsConfirmation.map((asset) => (
                  <ConfirmationRow
                    key={asset.id}
                    asset={asset}
                    selected={confirmations[asset.id]}
                    disabled={confirm.isPending}
                    onSelect={(status) =>
                      setConfirmations((current) => ({
                        ...current,
                        [asset.id]: status,
                      }))
                    }
                  />
                ))}
                <Pressable
                  accessibilityRole="button"
                  disabled={!selectedCount || confirm.isPending}
                  onPress={() => confirm.mutate()}
                  style={({ pressed }) => ({
                    padding: 13,
                    alignItems: 'center',
                    borderRadius: 13,
                    borderCurve: 'continuous',
                    backgroundColor: colors.text,
                    opacity:
                      pressed || !selectedCount || confirm.isPending
                        ? 0.55
                        : 1,
                  })}>
                  {confirm.isPending ? (
                    <ActivityIndicator color={colors.card} />
                  ) : (
                    <Text style={{ color: colors.card, fontWeight: '700' }}>
                      确认已选择的 {selectedCount} 件
                    </Text>
                  )}
                </Pressable>
                {confirm.error ? (
                  <ErrorState message={confirm.error.message} />
                ) : null}
              </>
            ) : (
              <Text selectable style={{ color: colors.muted }}>
                所有未售资产的状态都已确认。
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={refresh.isPending || !refreshableCount}
              onPress={() => refresh.mutate()}
              style={({ pressed }) => ({
                padding: 13,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.green,
                borderRadius: 13,
                borderCurve: 'continuous',
                opacity:
                  pressed || refresh.isPending || !refreshableCount
                    ? 0.55
                    : 1,
              })}>
              {refresh.isPending ? (
                <ActivityIndicator color={colors.green} />
              ) : (
                <Text style={{ color: colors.green, fontWeight: '700' }}>
                  刷新行情并重新计算
                </Text>
              )}
            </Pressable>
            {refresh.error ? (
              <ErrorState message={refresh.error.message} />
            ) : null}
          </View>
        ) : null}

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
