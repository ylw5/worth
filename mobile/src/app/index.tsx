import { Redirect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import { useSession } from '@/providers/session-provider';

export default function IndexScreen() {
  const { session, loading, error, retry } = useSession();
  if (loading) return <LoadingState label="正在进入资产库…" />;
  if (error || !session) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: spacing.xxl,
          gap: spacing.lg,
          backgroundColor: colors.background,
        }}>
        <Text
          selectable
          style={{
            color: colors.danger,
            textAlign: 'center',
            ...typography.body,
          }}>
          {error || '管理员会话不可用'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={({ pressed }) => ({
            alignItems: 'center',
            minHeight: 48,
            justifyContent: 'center',
            padding: spacing.lg,
            borderRadius: radius.medium,
            backgroundColor: colors.textPrimary,
            opacity: pressed ? 0.65 : 1,
          })}>
          <Text
            style={{
              ...typography.body,
              color: colors.onDark,
              fontWeight: '700',
            }}>
            重试
          </Text>
        </Pressable>
      </View>
    );
  }
  return <Redirect href="/(tabs)/(assets)" />;
}
