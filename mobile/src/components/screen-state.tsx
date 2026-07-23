import { ActivityIndicator, Text, View } from 'react-native';

import { colors } from '@/constants/colors';

export function LoadingState({ label = '加载中…' }: { label?: string }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={colors.green} />
      <Text selectable style={{ color: colors.muted }}>
        {label}
      </Text>
    </View>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Text
      selectable
      style={{ padding: 24, color: colors.danger, textAlign: 'center' }}>
      {message}
    </Text>
  );
}
