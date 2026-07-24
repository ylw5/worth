import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  LinearTransition,
} from 'react-native-reanimated';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency } from '@/lib/format';
import {
  filterTrend,
  jobCopy,
  trendChangeCopy,
  trendRangeLabels,
  trendRanges,
  trendStats,
  type TrendRange,
} from '@/lib/market-trend';
import type { MarketInsight, MarketSnapshot } from '@/types/domain';

const sparkHeight = 56;
const sparkWidth = 104;
const chartHeight = 168;
const expandTransition = LinearTransition.duration(240);
const expandEnter = FadeInDown.duration(220);
const expandExit = FadeOutUp.duration(160);
const sparkEnter = FadeIn.duration(180);
const sparkExit = FadeOut.duration(120);

type TrendRow = Pick<MarketSnapshot, 'snapshot_date' | 'estimated_price'>;

function buildChartData(rows: TrendRow[], { labeled }: { labeled: boolean }) {
  if (rows.length === 0) return [];
  const high = Math.max(...rows.map((row) => row.estimated_price));
  const highIndex = rows.findIndex((row) => row.estimated_price === high);
  const lastIndex = rows.length - 1;

  return rows.map((row, index) => {
    const isHigh = index === highIndex;
    const isLatest = index === lastIndex;
    const showLabel = labeled && (isHigh || isLatest);
    return {
      value: row.estimated_price,
      hideDataPoint: !showLabel,
      dataPointColor: colors.accent,
      dataPointRadius: 3,
      dataPointLabelComponent: showLabel
        ? () => (
            <Text
              style={{
                color: colors.textPrimary,
                ...typography.caption,
                fontWeight: '600',
                fontVariant: ['tabular-nums'],
              }}>
              {formatCurrency(row.estimated_price)}
            </Text>
          )
        : undefined,
      dataPointLabelShiftY: isHigh && !isLatest ? -18 : isLatest ? 14 : -18,
      dataPointLabelShiftX: isLatest ? -28 : -18,
    };
  });
}

function TrendAreaChart({
  rows,
  width,
  height,
  labeled,
}: {
  rows: TrendRow[];
  width: number;
  height: number;
  labeled?: boolean;
}) {
  const data = useMemo(
    () => buildChartData(rows, { labeled: Boolean(labeled) }),
    [rows, labeled],
  );
  const scale = useMemo(() => {
    if (rows.length === 0) return null;
    const prices = rows.map((row) => row.estimated_price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const span = Math.max(high - low, high * 0.02, 1);
    const pad = span * 0.25;
    const yAxisOffset = low - pad;
    return {
      yAxisOffset,
      maxValue: high + pad - yAxisOffset,
    };
  }, [rows]);

  if (width <= 0 || data.length === 0 || !scale) return null;

  const spacingPx =
    data.length <= 1 ? width : width / Math.max(data.length - 1, 1);

  return (
    <LineChart
      areaChart
      curved
      data={data}
      width={width}
      height={height}
      spacing={spacingPx}
      initialSpacing={0}
      endSpacing={0}
      yAxisOffset={scale.yAxisOffset}
      maxValue={scale.maxValue}
      color={colors.accent}
      thickness={labeled ? 2.5 : 1.75}
      startFillColor={colors.accent}
      endFillColor={colors.accent}
      startOpacity={labeled ? 0.22 : 0.18}
      endOpacity={0.02}
      hideRules
      hideYAxisText
      yAxisLabelWidth={0}
      yAxisThickness={0}
      xAxisThickness={0}
      xAxisLabelsHeight={0}
      disableScroll
      isAnimated={false}
      overflowTop={labeled ? 24 : 0}
      overflowBottom={labeled ? 24 : 0}
    />
  );
}

export function MarketValuationCard({
  insight,
}: {
  insight: MarketInsight;
}) {
  const [expanded, setExpanded] = useState(false);
  const [range, setRange] = useState<TrendRange>('1w');
  const [chartWidth, setChartWidth] = useState(0);
  const latest = insight.snapshots.at(-1);
  const rows = filterTrend(insight.snapshots, range);
  const stats = rows.length < 2 ? null : trendStats(rows);
  const changeText = trendChangeCopy(stats, range);
  const changeColor =
    stats && stats.change > 0
      ? colors.green
      : stats && stats.change < 0
        ? colors.danger
        : colors.textSecondary;
  const failed = insight.run?.status === 'failed';

  return (
    <Animated.View
      layout={expandTransition}
      style={{
        padding: spacing.lg,
        gap: spacing.lg,
        borderRadius: radius.large,
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
        }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
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
            {latest ? formatCurrency(latest.estimated_price) : '—'}
          </Text>
          <Text
            selectable
            style={{
              color: changeColor,
              ...typography.label,
              fontVariant: ['tabular-nums'],
            }}>
            {changeText}
          </Text>
          {failed ? (
            <Text
              selectable
              style={{ color: colors.danger, ...typography.caption }}>
              {jobCopy(insight.run)}
            </Text>
          ) : null}
        </View>

        {!expanded ? (
          <Animated.View entering={sparkEnter} exiting={sparkExit}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="展开市场趋势"
              onPress={() => setExpanded(true)}
              hitSlop={8}
              style={{
                width: sparkWidth,
                height: sparkHeight,
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden',
              }}>
              {rows.length === 0 ? (
                <Text
                  style={{
                    color: colors.textSecondary,
                    ...typography.caption,
                    textAlign: 'center',
                  }}>
                  暂无行情
                </Text>
              ) : (
                <View pointerEvents="none">
                  <TrendAreaChart
                    rows={rows}
                    width={sparkWidth}
                    height={sparkHeight}
                  />
                </View>
              )}
            </Pressable>
          </Animated.View>
        ) : null}
      </View>

      {expanded ? (
        <Animated.View
          entering={expandEnter}
          exiting={expandExit}
          layout={expandTransition}
          style={{ gap: spacing.lg }}>
          {rows.length === 0 ? (
            <Text
              selectable
              style={{ color: colors.textSecondary, ...typography.body }}>
              暂无行情
            </Text>
          ) : (
            <View
              accessible
              accessibilityLabel={`共 ${rows.length} 个行情点`}
              onLayout={(event) =>
                setChartWidth(event.nativeEvent.layout.width)
              }
              style={{ height: chartHeight + 48, justifyContent: 'center' }}>
              {chartWidth > 0 ? (
                <TrendAreaChart
                  rows={rows}
                  width={chartWidth}
                  height={chartHeight}
                  labeled
                />
              ) : null}
            </View>
          )}

          <View style={{ gap: spacing.xs }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
              {trendRanges.map((value) => {
                const selected = range === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setRange(value)}
                    hitSlop={6}
                    style={{
                      flex: 1,
                      minHeight: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: selected
                        ? colors.surfaceMuted
                        : 'transparent',
                    }}>
                    <Text
                      style={{
                        color: selected
                          ? colors.textPrimary
                          : colors.textSecondary,
                        ...typography.label,
                        fontWeight: selected ? '600' : '400',
                      }}>
                      {trendRangeLabels[value]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="收起市场趋势"
              onPress={() => setExpanded(false)}
              hitSlop={10}
              style={{
                minHeight: 28,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <SymbolView
                name={{
                  ios: 'chevron.up',
                  android: 'keyboard_arrow_up',
                  web: 'keyboard_arrow_up',
                }}
                size={18}
                tintColor={colors.textSecondary}
              />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
