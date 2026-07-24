import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatPurchaseDate } from '@/lib/purchase-input';

export function PurchaseDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());

  const show = () => {
    setDraft(value ? new Date(`${value}T00:00:00`) : new Date());
    setOpen(true);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
        实际买入日期（可选）
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable
          accessibilityLabel="选择实际买入日期"
          accessibilityRole="button"
          onPress={show}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 48,
            justifyContent: 'center',
            padding: spacing.lg,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.small,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
            opacity: pressed ? 0.65 : 1,
          })}>
          <Text
            style={{
              color: value ? colors.textPrimary : colors.textTertiary,
              ...typography.body,
            }}>
            {value || '请选择日期'}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            accessibilityLabel="清空实际买入日期"
            accessibilityRole="button"
            onPress={() => onChange('')}>
            <Text style={{ color: colors.accent, ...typography.label }}>清空</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <>
          <DateTimePicker
            accentColor={colors.accent}
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            maximumDate={new Date()}
            mode="date"
            onDismiss={() => setOpen(false)}
            onValueChange={(_, date) => {
              if (Platform.OS === 'android') {
                onChange(formatPurchaseDate(date));
                setOpen(false);
              } else {
                setDraft(date);
              }
            }}
            presentation="dialog"
            value={draft}
          />
          {Platform.OS === 'ios' ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: 18,
              }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setOpen(false)}>
                <Text style={{ color: colors.textSecondary, ...typography.label }}>
                  取消
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onChange(formatPurchaseDate(draft));
                  setOpen(false);
                }}>
                <Text
                  style={{
                    color: colors.textPrimary,
                    ...typography.label,
                    fontWeight: '700',
                  }}>
                  确定
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
