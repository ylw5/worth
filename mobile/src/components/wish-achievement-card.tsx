import { Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { formatCurrency, formatDate } from '@/lib/format';

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: spacing.sm,
      }}>
      <Text style={{ color: colors.accent, ...typography.label }}>★</Text>
      <Text
        selectable
        style={{
          flex: 1,
          color: colors.textSecondary,
          ...typography.label,
        }}>
        {label}
        {'  '}
        <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
          {value}
        </Text>
      </Text>
    </View>
  );
}

export function WishAchievementCard({
  name,
  actualPrice,
  fulfilledAt,
}: {
  name: string;
  actualPrice: number;
  fulfilledAt: string;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: spacing.xxl,
        paddingVertical: spacing.xxxl,
        paddingHorizontal: spacing.xl,
        backgroundColor: colors.surface,
        borderRadius: radius.large,
        borderCurve: 'continuous',
      }}>
      <View style={{ alignItems: 'center', gap: spacing.lg }}>
        <View
          style={{
            width: 168,
            height: 168,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              width: 160,
              height: 160,
              borderRadius: 80,
              borderWidth: 12,
              borderColor: colors.accent,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text
              style={{
                color: colors.textPrimary,
                ...typography.display,
                fontVariant: ['tabular-nums'],
              }}>
              100%
            </Text>
          </View>
          <View
            style={{
              position: 'absolute',
              top: 0,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 3,
              borderColor: colors.surface,
            }}>
            <Text
              style={{
                color: colors.onDark,
                fontSize: 18,
                fontWeight: '700',
                lineHeight: 20,
              }}>
              ✓
            </Text>
          </View>
        </View>
        <Text
          selectable
          numberOfLines={2}
          style={{
            color: colors.textPrimary,
            textAlign: 'center',
            ...typography.sectionTitle,
          }}>
          {name}
        </Text>
      </View>

      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <Text
          style={{
            color: colors.textPrimary,
            ...typography.pageTitle,
            textAlign: 'center',
          }}>
          心愿达成！
        </Text>
        <Text
          style={{
            color: colors.textSecondary,
            ...typography.body,
            textAlign: 'center',
          }}>
          恭喜实现心愿
        </Text>
      </View>

      <View style={{ width: '100%', gap: spacing.md, paddingHorizontal: spacing.md }}>
        <FactRow label="心愿名称" value={name} />
        <FactRow label="实际成交价" value={formatCurrency(actualPrice)} />
        <FactRow label="实现日期" value={formatDate(fulfilledAt)} />
      </View>
    </View>
  );
}
