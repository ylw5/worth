import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import {
  filterTrend,
  plotTrend,
  trendStats,
  type TrendRange,
} from '@/lib/market-trend';
import type { MarketSnapshot } from '@/types/domain';

const ranges: [TrendRange, string][] = [
  ['30d', '30 天'],
  ['90d', '90 天'],
  ['all', '全部'],
];
const chartHeight = 120;
const pointRadius = 3;

export function MarketTrendCard({
  snapshots,
}: {
  snapshots: MarketSnapshot[];
}) {
  const [range, setRange] = useState<TrendRange>('30d');
  const [width, setWidth] = useState(0);
  const rows = filterTrend(snapshots, range);
  const points = plotTrend(
    rows,
    Math.max(0, width - pointRadius * 2),
    chartHeight - pointRadius * 2,
  ).map((point) => ({
    x: point.x + pointRadius,
    y: point.y + pointRadius,
  }));
  const stats = trendStats(rows);

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.lg,
        borderRadius: radius.large,
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
      }}>
      <View style={{ gap: spacing.md }}>
        <Text
          selectable
          style={{ color: colors.textPrimary, ...typography.cardTitle }}>
          市场趋势
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {ranges.map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: range === value }}
              onPress={() => setRange(value)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radius.pill,
                backgroundColor:
                  range === value ? colors.accentSoft : colors.surfaceMuted,
              }}>
              <Text style={{ color: colors.textPrimary, ...typography.label }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {rows.length === 0 ? (
        <Text
          selectable
          style={{ color: colors.textSecondary, ...typography.body }}>
          暂无行情
        </Text>
      ) : (
        <>
          <View
            accessible
            accessibilityLabel={`共 ${rows.length} 个行情点`}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={{ height: chartHeight }}>
            {points.slice(1).map((point, index) => {
              const previous = points[index];
              const dx = point.x - previous.x;
              const dy = point.y - previous.y;
              const length = Math.hypot(dx, dy);
              return (
                <View
                  key={`${rows[index].snapshot_date}-line`}
                  style={{
                    position: 'absolute',
                    left: (point.x + previous.x - length) / 2,
                    top: (point.y + previous.y) / 2,
                    width: length,
                    height: 2,
                    backgroundColor: colors.accent,
                    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                  }}
                />
              );
            })}
            {points.map((point, index) => (
              <View
                key={rows[index].snapshot_date}
                style={{
                  position: 'absolute',
                  left: point.x - pointRadius,
                  top: point.y - pointRadius,
                  width: pointRadius * 2,
                  height: pointRadius * 2,
                  borderRadius: pointRadius,
                  backgroundColor: colors.accent,
                }}
              />
            ))}
          </View>
          {rows.length === 1 ? (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.label }}>
              行情积累中
            </Text>
          ) : null}
          {stats ? (
            <Text
              selectable
              style={{
                color: colors.textSecondary,
                ...typography.label,
                fontVariant: ['tabular-nums'],
              }}>
              涨跌 {stats.change >= 0 ? '+' : ''}
              {formatCurrency(stats.change)} ·{' '}
              {stats.percent === null
                ? '—'
                : `${stats.percent >= 0 ? '+' : ''}${stats.percent}%`}
              {' · '}最高 {formatCurrency(stats.high)}
              {' · '}最低 {formatCurrency(stats.low)}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
