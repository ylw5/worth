import { Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import { historicalPoints, holdingCost } from '@/lib/holding-cost';
import type { Asset, MarketInsight } from '@/types/domain';

import { ResidualHistoryChart } from './residual-history-chart';
import { ResidualForecast } from './residual-forecast';
import { ReplacementComparison } from './replacement-comparison';

const amount = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value);

export function HoldingCostView({
  asset,
  insight,
}: {
  asset: Asset;
  insight: MarketInsight;
}) {
  const latest =
    insight.snapshots[0]?.estimated_price ?? asset.latest_market_price;
  const result = holdingCost({
    purchasePrice: asset.purchase_price,
    currentValue: latest,
    purchaseDate: asset.purchase_date,
  });
  if (!result) {
    return (
      <View style={{ gap: spacing.lg }}>
        <Text style={{ color: colors.textSecondary, ...typography.body }}>
          补充买入日期和价格，并等待一次后台估值后即可计算持有成本。
        </Text>
        <ResidualForecast forecast={insight.forecast} />
        <ReplacementComparison asset={asset} forecast={insight.forecast} />
      </View>
    );
  }
  const points = historicalPoints(
    asset.purchase_price,
    asset.purchase_date,
    insight.snapshots,
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <View>
        <Text style={{ color: colors.textSecondary, ...typography.label }}>
          {result.dailyLoss < 0 ? '平均每天增值' : '平均每天花掉'}
        </Text>
        <Text style={{ color: colors.textPrimary, ...typography.display }}>
          {amount(Math.abs(result.dailyLoss))}
        </Text>
        <Text style={{ color: colors.textSecondary, ...typography.body }}>
          已持有 {result.ownedDays} 天 · 累计变化{' '}
          {formatCurrency(result.totalLoss)} · 年化
          {result.annualizedLoss < 0 ? '增值' : '持有成本'}{' '}
          {formatCurrency(Math.abs(result.annualizedLoss))}
        </Text>
        {result.ownedDays < 30 ? (
          <Text style={{ color: colors.textSecondary, ...typography.label }}>
            持有不足 30 天，年化结果波动较大
          </Text>
        ) : null}
      </View>
      <ResidualHistoryChart points={points} />
      <ResidualForecast forecast={insight.forecast} />
      <ReplacementComparison asset={asset} forecast={insight.forecast} />
    </View>
  );
}
