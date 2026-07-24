import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { recordReplacementScenario } from '@/lib/assets';
import { formatCurrency } from '@/lib/format';
import { compareReplacement } from '@/lib/replacement';
import { listWishlistItems } from '@/lib/wishlist';
import type { Asset, AssetForecast } from '@/types/domain';

export function ReplacementComparison({
  asset,
  forecast,
}: {
  asset: Asset;
  forecast: AssetForecast | null;
}) {
  const wishlist = useQuery({
    queryKey: ['wishlist'],
    queryFn: listWishlistItems,
    enabled: Boolean(forecast && forecast.method !== 'unavailable'),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<6 | 12>(6);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const selected =
    wishlist.data?.find((item) => item.id === selectedId) ??
    wishlist.data?.[0] ??
    null;
  const futureValue =
    horizon === 6 ? forecast?.value_6m : forecast?.value_12m;
  const comparison = compareReplacement(
    selected?.target_price ?? null,
    asset.latest_market_price,
    futureValue ?? null,
  );

  if (!forecast) {
    return (
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        等待未来残值估算后即可进行换新对比
      </Text>
    );
  }
  if (forecast.method === 'unavailable') {
    return (
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        暂不提供换新对比：{forecast.reason}
      </Text>
    );
  }
  if (wishlist.error) {
    return (
      <Text style={{ color: colors.danger, ...typography.label }}>
        {wishlist.error.message}
      </Text>
    );
  }
  if (!wishlist.isLoading && !wishlist.data?.length) {
    return (
      <Link href="/(tabs)/(wishlist)" style={{ color: colors.accent }}>
        先在心愿单添加换新目标
      </Link>
    );
  }

  const save = async () => {
    if (
      !comparison ||
      !selected ||
      !forecast ||
      asset.latest_market_price == null ||
      futureValue == null
    ) {
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await recordReplacementScenario({
        asset_id: asset.id,
        wishlist_item_id: selected.id,
        forecast_id: forecast.id,
        horizon_months: horizon,
        target_price: selected.target_price,
        current_asset_value: asset.latest_market_price,
        future_asset_value: futureValue,
        change_now_cash: comparison.changeNowCash,
        change_later_cash: comparison.changeLaterCash,
        waiting_cash_difference: comparison.waitingCashDifference,
        assumptions: {
          target_price_constant: true,
          fees_included: false,
          source: 'user_wishlist',
        },
      });
      setMessage('对比已保存');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ ...typography.body, fontWeight: '700' }}>
        换新现金差
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.small,
        }}>
        <Text style={{ ...typography.body }}>
          {selected?.name ?? '选择心愿单目标'}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {([6, 12] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: horizon === value }}
            onPress={() => setHorizon(value)}
            style={{
              minHeight: 44,
              paddingHorizontal: spacing.lg,
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor:
                horizon === value ? colors.textPrimary : colors.surfaceMuted,
            }}>
            <Text
              style={{
                color:
                  horizon === value
                    ? colors.onDark
                    : colors.textSecondary,
                ...typography.label,
              }}>
              {value} 个月
            </Text>
          </Pressable>
        ))}
      </View>
      {comparison ? (
        <>
          <Text style={{ ...typography.body }}>
            现在换需补 {formatCurrency(comparison.changeNowCash)}
          </Text>
          <Text style={{ ...typography.body }}>
            {horizon} 个月后换预计需补{' '}
            {formatCurrency(comparison.changeLaterCash)}
          </Text>
          <Text style={{ ...typography.body }}>
            等待期间补差变化{' '}
            {formatCurrency(comparison.waitingCashDifference)}
          </Text>
          <Text style={{ color: colors.textTertiary, ...typography.label }}>
            假设目标物价格不变，未计交易手续费；仅作数值对比，不构成换新建议
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={save}
            style={({ pressed }) => ({
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.small,
              backgroundColor: colors.textPrimary,
              opacity: pressed || saving ? 0.65 : 1,
            })}>
            <Text
              style={{
                color: colors.onDark,
                ...typography.body,
                fontWeight: '700',
              }}>
              保存对比
            </Text>
          </Pressable>
        </>
      ) : (
        <Text style={{ color: colors.textSecondary, ...typography.label }}>
          需要当前行情和可用的未来残值估算后才能对比
        </Text>
      )}
      {message ? (
        <Text style={{ color: colors.textSecondary, ...typography.label }}>
          {message}
        </Text>
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭目标选择"
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: spacing.xl,
            backgroundColor: 'rgba(0,0,0,0.35)',
          }}>
          <View
            style={{
              gap: spacing.sm,
              padding: spacing.lg,
              borderRadius: radius.large,
              backgroundColor: colors.surface,
            }}>
            {(wishlist.data ?? []).map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected?.id === item.id }}
                onPress={() => {
                  setSelectedId(item.id);
                  setOpen(false);
                }}
                style={{
                  minHeight: 48,
                  justifyContent: 'center',
                  paddingHorizontal: spacing.lg,
                }}>
                <Text style={{ ...typography.body }}>
                  {item.name} · {formatCurrency(item.target_price)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
