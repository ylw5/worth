import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import type { AssetSaleWithName } from '@/lib/assets';
import { formatCurrency, formatDate } from '@/lib/format';
import type { ConfirmedSpendingResolution } from '@/lib/spending-resolutions';
import type { WishlistFundingAllocation } from '@/lib/wishlist-fulfillment';
import type { WishlistItem } from '@/lib/wishlist';
import { sumAmounts } from '@/lib/wishlist-progress';

type FulfilledWishlistCardProps = {
  item: WishlistItem & {
    actual_price: number;
    fulfilled_at: string;
  };
  allocations: WishlistFundingAllocation[];
  resolutions: ConfirmedSpendingResolution[];
  sales: AssetSaleWithName[];
  undoing: boolean;
  onUndo: (id: string, name: string) => void;
};

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}>
      <Text
        selectable
        style={{ color: colors.textSecondary, ...typography.label }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          ...typography.label,
          fontWeight: '600',
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(value)}
      </Text>
    </View>
  );
}

export function FulfilledWishlistCard({
  item,
  allocations,
  resolutions,
  sales,
  undoing,
  onUndo,
}: FulfilledWishlistCardProps) {
  const [expanded, setExpanded] = useState(false);
  const itemAllocations = allocations.filter(
    (allocation) => allocation.wishlist_item_id === item.id,
  );
  const resolutionNames = new Map(
    resolutions.map((resolution) => [
      resolution.id,
      resolution.product_snapshot.title,
    ]),
  );
  const saleNames = new Map(sales.map((sale) => [sale.id, sale.asset.name]));
  const spendingTotal = sumAmounts(
    itemAllocations
      .filter((allocation) => allocation.spending_resolution_id)
      .map((allocation) => allocation.amount),
  );
  const salesTotal = sumAmounts(
    itemAllocations
      .filter((allocation) => allocation.asset_sale_id)
      .map((allocation) => allocation.amount),
  );
  const selfPaid = Math.max(
    item.actual_price - spendingTotal - salesTotal,
    0,
  );

  const confirmUndo = () => {
    Alert.alert(
      '撤销实现？',
      `“${item.name}”会回到未实现，已使用资金将恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '撤销实现',
          style: 'destructive',
          onPress: () => onUndo(item.id, item.name),
        },
      ],
    );
  };

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.md,
        backgroundColor: colors.surface,
        borderRadius: radius.large,
        borderCurve: 'continuous',
      }}>
      <View style={{ gap: spacing.xs }}>
        <Text
          selectable
          style={{ color: colors.textPrimary, ...typography.cardTitle }}>
          {item.name}
        </Text>
        <Text
          selectable
          style={{ color: colors.textSecondary, ...typography.caption }}>
          {formatDate(item.fulfilled_at)}
        </Text>
      </View>
      <Text
        selectable
        style={{
          color: colors.textPrimary,
          ...typography.sectionTitle,
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(item.actual_price)}
      </Text>
      <View style={{ gap: spacing.sm }}>
        <TotalRow label="忍住消费抵扣" value={spendingTotal} />
        <TotalRow label="已卖闲置抵扣" value={salesTotal} />
        <TotalRow label="自付金额" value={selfPaid} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        })}>
        <Text style={{ color: colors.accent, fontWeight: '700' }}>
          {expanded ? '收起资金明细' : '查看资金明细'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={{ gap: spacing.md }}>
          {itemAllocations.length ? (
            itemAllocations.map((allocation) => {
              const resolutionId = allocation.spending_resolution_id;
              const saleId = allocation.asset_sale_id;
              const name = resolutionId
                ? resolutionNames.get(resolutionId) ?? '忍住消费记录'
                : saleNames.get(saleId ?? '') ?? '闲置成交记录';
              return (
                <View
                  key={allocation.id}
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
                      ...typography.label,
                    }}>
                    {name}
                  </Text>
                  <Text
                    selectable
                    style={{
                      color: colors.textPrimary,
                      ...typography.label,
                      fontWeight: '600',
                      fontVariant: ['tabular-nums'],
                    }}>
                    {formatCurrency(allocation.amount)}
                  </Text>
                </View>
              );
            })
          ) : (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.body }}>
              全部自付
            </Text>
          )}
        </View>
      ) : null}
      <Pressable
        accessibilityLabel={`撤销实现${item.name}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: undoing }}
        disabled={undoing}
        onPress={confirmUndo}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          opacity: pressed || undoing ? 0.6 : 1,
        })}>
        {undoing ? (
          <ActivityIndicator color={colors.danger} size="small" />
        ) : null}
        <Text style={{ color: colors.danger, fontWeight: '700' }}>
          {undoing ? '撤销中…' : '撤销实现'}
        </Text>
      </Pressable>
    </View>
  );
}
