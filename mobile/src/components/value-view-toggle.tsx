import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';

export type ValueView = 'holding' | 'market';

export function ValueViewToggle({
  value,
  onChange,
}: {
  value: ValueView;
  onChange: (value: ValueView) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        padding: spacing.xs,
        borderRadius: radius.large,
        backgroundColor: colors.background,
      }}>
      {([
        ['holding', '年化持有成本'],
        ['market', '今日行情'],
      ] as const).map(([key, label]) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === key }}
          onPress={() => onChange(key)}
          style={{
            flex: 1,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.medium,
            backgroundColor:
              value === key ? colors.surface : 'transparent',
          }}>
          <Text style={{ ...typography.body, fontWeight: '700' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
