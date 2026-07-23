import { Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { formatPurchaseDate } from '@/lib/purchase-input';

export function PurchaseDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
        实际买入日期（可选）
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          aria-label="实际买入日期"
          max={formatPurchaseDate(new Date())}
          onChange={(event) => onChange(event.currentTarget.value)}
          type="date"
          value={value}
          style={{
            flex: 1,
            minWidth: 0,
            padding: 14,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            background: colors.card,
            color: colors.text,
            font: 'inherit',
          }}
        />
        {value ? (
          <Pressable
            accessibilityLabel="清空实际买入日期"
            accessibilityRole="button"
            onPress={() => onChange('')}>
            <Text style={{ color: colors.green }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
