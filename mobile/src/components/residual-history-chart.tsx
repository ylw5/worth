import { Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/colors';

type Point = {
  date: string;
  value: number;
  kind: 'purchase' | 'market';
};

export function ResidualHistoryChart({ points }: { points: Point[] }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const span = Math.max(Math.max(...values) - min, 1);

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...typography.body, fontWeight: '700' }}>残值曲线</Text>
      <View
        accessibilityLabel={`残值从 ${points[0].value} 变化到 ${points.at(-1)?.value}`}
        style={{
          height: 150,
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 2,
        }}>
        {points.map((point) => (
          <View
            key={`${point.date}-${point.kind}`}
            style={{
              flex: 1,
              minWidth: 3,
              height: 8 + ((point.value - min) / span) * 130,
              borderRadius: 3,
              backgroundColor:
                point.kind === 'purchase'
                  ? colors.textTertiary
                  : colors.accent,
            }}
          />
        ))}
      </View>
      <Text style={{ color: colors.textSecondary, ...typography.label }}>
        仅展示买入价与已采集历史，不包含未来预测
      </Text>
    </View>
  );
}
