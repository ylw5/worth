import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatPurchaseDate } from '@/lib/purchase-input';

export function PurchaseDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
        实际买入日期（可选）
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          aria-label="实际买入日期"
          max={formatPurchaseDate(new Date())}
          onInput={(event) => onChange(event.currentTarget.value)}
          type="date"
          value={value}
          style={{
            flex: 1,
            minWidth: 0,
            padding: spacing.lg,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.small,
            background: colors.surface,
            color: colors.textPrimary,
            font: 'inherit',
          }}
        />
        {value ? (
          <Pressable
            accessibilityLabel="清空实际买入日期"
            accessibilityRole="button"
            onPress={() => onChange('')}>
            <Text style={{ color: colors.accent, ...typography.label }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
