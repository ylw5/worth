import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  selectedId,
  onSelect,
  onNewChat,
  onClose,
}: {
  items: PurchaseEvaluation[];
  loading: boolean;
  errorMessage?: string;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        paddingTop: insets.top + spacing.sm,
        paddingBottom: Math.max(insets.bottom, spacing.md),
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.md,
        }}>
        <Text
          selectable
          style={{
            fontSize: 28,
            fontWeight: '700',
            color: colors.textPrimary,
            letterSpacing: -0.4,
          }}>
          聊天
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭历史"
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 99,
            backgroundColor: colors.surfaceMuted,
            opacity: pressed ? 0.7 : 1,
          })}>
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={16}
            tintColor={colors.textPrimary}
          />
        </Pressable>
      </View>

      <Text
        selectable
        style={{
          fontSize: 13,
          fontWeight: '600',
          color: colors.textSecondary,
          paddingHorizontal: spacing.xl,
          marginBottom: spacing.xs,
        }}>
        最近
      </Text>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.lg,
          gap: 2,
        }}>
        {loading ? <LoadingState /> : null}
        {errorMessage ? <ErrorState message={errorMessage} /> : null}
        {items.map((item) => {
          const decision = item.decision ?? 'pending';
          const selected = item.id === selectedId;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={item.product_title}
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.md,
                paddingVertical: 14,
                borderRadius: radius.medium,
                backgroundColor:
                  selected || pressed ? colors.surfaceMuted : 'transparent',
                gap: 5,
              })}>
              <Text
                selectable
                numberOfLines={2}
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: colors.textPrimary,
                  lineHeight: 21,
                }}>
                {item.product_title}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  color: colors.textSecondary,
                  lineHeight: 17,
                }}>
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
              paddingHorizontal: spacing.md,
              paddingTop: spacing.lg,
            }}>
            还没有记录
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新聊天"
          onPress={onNewChat}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.78 : 1,
          })}>
          <SymbolView
            name={{
              ios: 'square.and.pencil',
              android: 'edit',
              web: 'edit',
            }}
            size={18}
            tintColor={colors.onDark}
          />
          <Text
            style={{ color: colors.onDark, fontWeight: '700', fontSize: 16 }}>
            新聊天
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
