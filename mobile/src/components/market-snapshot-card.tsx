import { Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency, formatDate } from '@/lib/format';
import { jobCopy } from '@/lib/market-trend';
import type { MarketInsight } from '@/types/domain';

export function MarketSnapshotCard({
  insight,
}: {
  insight: MarketInsight;
}) {
  const latest = insight.snapshots.at(-1);

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.sm,
        borderRadius: radius.large,
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
      }}>
      <Text
        selectable
        style={{ color: colors.textSecondary, ...typography.label }}>
        当前参考市价
      </Text>
      <Text
        selectable
        style={{
          color: latest ? colors.textPrimary : colors.textTertiary,
          ...typography.display,
          fontVariant: ['tabular-nums'],
        }}>
        {formatCurrency(latest?.estimated_price ?? null)}
      </Text>
      <Text
        selectable
        style={{ color: colors.textSecondary, ...typography.label }}>
        {latest
          ? `${formatCurrency(latest.price_low)}–${formatCurrency(
              latest.price_high,
            )} · ${latest.sample_count} 个在售样本`
          : '暂无可靠估价'}
      </Text>
      <Text
        selectable
        style={{
          color:
            insight.run?.status === 'failed'
              ? colors.danger
              : colors.textSecondary,
          ...typography.label,
        }}>
        {jobCopy(insight.run)}
      </Text>
      {latest ? (
        <Text
          selectable
          style={{ color: colors.textTertiary, ...typography.caption }}>
          数据源：闲鱼在售样本 · {formatDate(latest.created_at)}
        </Text>
      ) : null}
    </View>
  );
}
