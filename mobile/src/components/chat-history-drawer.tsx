import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  evaluationDecisionLabels,
  type PurchaseEvaluation,
} from '@/lib/evaluations';
import { formatDate } from '@/lib/format';

export function ChatHistoryDrawer({
  items,
  loading,
  errorMessage,
  onSelect,
  onNewChat,
}: {
  items: PurchaseEvaluation[];
  loading: boolean;
  errorMessage?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        paddingTop: insets.top + spacing.md,
        paddingBottom: Math.max(insets.bottom, spacing.md),
      }}>
      <Text
        selectable
        style={{
          ...typography.sectionTitle,
          color: colors.textPrimary,
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.lg,
        }}>
        聊天
      </Text>

      <Text
        selectable
        style={{
          ...typography.caption,
          color: colors.textSecondary,
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.sm,
        }}>
        最近
      </Text>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
          gap: spacing.xs,
        }}>
        {loading ? <LoadingState /> : null}
        {errorMessage ? <ErrorState message={errorMessage} /> : null}
        {items.map((item) => {
          const decision = item.decision ?? 'pending';
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.product_title}
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                borderRadius: radius.medium,
                backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                gap: 4,
              })}>
              <Text
                selectable
                numberOfLines={2}
                style={{ ...typography.cardTitle, color: colors.textPrimary }}>
                {item.product_title}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{ ...typography.caption, color: colors.textSecondary }}>
                {evaluationDecisionLabels[decision]} ·{' '}
                {formatDate(item.updated_at ?? item.created_at)}
              </Text>
            </Pressable>
          );
        })}
        {!loading && !errorMessage && !items.length ? (
          <Text
            selectable
            style={{
              ...typography.label,
              color: colors.muted,
              paddingHorizontal: spacing.sm,
              paddingTop: spacing.sm,
            }}>
            还没有记录
          </Text>
        ) : null}
      </ScrollView>

      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新聊天"
          onPress={onNewChat}
          style={({ pressed }) => ({
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.75 : 1,
          })}>
          <Text
            style={{ color: colors.onDark, fontWeight: '700', fontSize: 16 }}>
            新聊天
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
