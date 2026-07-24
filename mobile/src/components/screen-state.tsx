import { ActivityIndicator, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/constants/colors';

export function LoadingState({ label = '加载中…' }: { label?: string }) {
  return (
    <View
      style={{
        padding: spacing.xxxl,
        alignItems: 'center',
        gap: spacing.md,
      }}>
      <ActivityIndicator color={colors.textSecondary} />
      <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
        {label}
      </Text>
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Text
      selectable
      style={{
        padding: spacing.xxl,
        color: colors.danger,
        textAlign: 'center',
        ...typography.body,
      }}>
      {message}
    </Text>
  );
}
