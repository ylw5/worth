import { Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/colors';
import { formatCurrency, formatDate } from '@/lib/format';
import type { AssetForecast } from '@/types/domain';

export function ResidualForecast({
  forecast,
}: {
  forecast: AssetForecast | null;
}) {
  if (!forecast) return null;
  if (forecast.method === 'unavailable') {
    return (
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        暂不提供未来估算：{forecast.reason}
      </Text>
    );
  }
  const level =
    forecast.confidence >= 0.75
      ? '高'
      : forecast.confidence >= 0.5
        ? '中'
        : '低';

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...typography.body, fontWeight: '700' }}>
        未来残值估算
      </Text>
      <Text style={{ ...typography.body }}>
        6 个月 {formatCurrency(forecast.value_6m)} ·{' '}
        {formatCurrency(forecast.low_6m)}–
        {formatCurrency(forecast.high_6m)}
      </Text>
      <Text style={{ ...typography.body }}>
        12 个月 {formatCurrency(forecast.value_12m)} ·{' '}
        {formatCurrency(forecast.low_12m)}–
        {formatCurrency(forecast.high_12m)}
      </Text>
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        置信度 {Math.round(forecast.confidence * 100)}%（{level}）·{' '}
        {forecast.reason} · 更新于 {formatDate(forecast.created_at)}
      </Text>
      <Text style={{ color: colors.textTertiary, ...typography.label }}>
        基于历史行情与博查检索到的公开资料，结果为估算，不构成交易建议
      </Text>
    </View>
  );
}
