import { Link, Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { useSession } from '@/providers/session-provider';

export default function AccountScreen() {
  const { session } = useSession();

  return (
    <>
      <Stack.Screen options={{ title: '账号', headerLargeTitle: true }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
        <View
          style={{
            borderRadius: radius.large,
            borderCurve: 'continuous',
            backgroundColor: colors.surface,
            overflow: 'hidden',
          }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.lg,
              gap: spacing.lg,
            }}>
            <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
              账号
            </Text>
            <Text
              selectable
              style={{
                flex: 1,
                color: colors.textPrimary,
                textAlign: 'right',
                ...typography.body,
              }}>
              {session?.user.email}
            </Text>
          </View>
          <View style={{ height: 1, backgroundColor: colors.border, marginLeft: spacing.lg }} />
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.lg,
              gap: spacing.lg,
            }}>
            <Text selectable style={{ color: colors.textSecondary, ...typography.label }}>
              角色
            </Text>
            <Text
              selectable
              style={{
                flex: 1,
                color: colors.textPrimary,
                textAlign: 'right',
                ...typography.body,
              }}>
              固定管理员
            </Text>
          </View>
        </View>
        <Link href="/(tabs)/(account)/memories" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.lg,
              borderRadius: radius.large,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.65 : 1,
            })}>
            <Text style={{ color: colors.textPrimary, ...typography.cardTitle }}>
              Agent 记忆与回访
            </Text>
            <Text
              style={{
                marginTop: spacing.xs,
                color: colors.textSecondary,
                ...typography.label,
              }}>
              查看待回访事项，管理 Agent 可以跨对话引用的记忆
            </Text>
          </Pressable>
        </Link>
      </ScrollView>
    </>
  );
}
