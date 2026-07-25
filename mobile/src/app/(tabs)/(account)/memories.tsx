import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { ErrorState, LoadingState } from '@/components/screen-state';
import { colors, radius, spacing, typography } from '@/constants/colors';
import {
  dismissAgentFollowup,
  forgetAgentMemory,
  listAgentMemories,
  listPendingFollowups,
  type AgentFollowup,
  type AgentMemory,
} from '@/lib/agent-memory';
import {
  evaluationOutcomeLabels,
  evaluationUserChoiceLabels,
} from '@/lib/evaluations';
import { formatDate } from '@/lib/format';

function followupLabel(item: AgentFollowup): string {
  const due = new Date(item.due_at);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return '现在适合回访';
  return `${days} 天后提醒`;
}

function memoryDescription(memory: AgentMemory): string {
  const facts = memory.facts;
  const choice = facts.user_choice
    ? evaluationUserChoiceLabels[facts.user_choice]
    : '还没记录选择';
  const outcome = facts.outcome_status
    ? evaluationOutcomeLabels[facts.outcome_status]
    : '后续未知';
  return `${choice} · ${outcome}`;
}

export default function AgentMemoriesScreen() {
  const queryClient = useQueryClient();
  const memories = useQuery({
    queryKey: ['agent-memories'],
    queryFn: listAgentMemories,
  });
  const followups = useQuery({
    queryKey: ['agent-followups'],
    queryFn: listPendingFollowups,
  });
  const forget = useMutation({
    mutationFn: forgetAgentMemory,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['agent-memories'] }),
  });
  const dismiss = useMutation({
    mutationFn: dismissAgentFollowup,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['agent-followups'] }),
  });

  const confirmForget = (memory: AgentMemory) => {
    Alert.alert(
      '删除这条记忆？',
      '删除后，Agent 不会再在其他对话里引用这段经历。原始评估记录仍会保留。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除记忆',
          style: 'destructive',
          onPress: () => forget.mutate(memory.id),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Agent 记忆与回访' }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.xxl }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.textPrimary, ...typography.sectionTitle }}>
            待回访
          </Text>
          <Text style={{ color: colors.textSecondary, ...typography.body }}>
            只在你选择“买了”或“再等等”后生成，可以随时忽略。
          </Text>
        </View>

        {followups.isLoading ? <LoadingState /> : null}
        {followups.error ? <ErrorState message={followups.error.message} /> : null}
        {!followups.isLoading && !(followups.data ?? []).length ? (
          <Text style={{ color: colors.textSecondary, ...typography.body }}>
            暂时没有需要回访的事情。
          </Text>
        ) : null}
        {(followups.data ?? []).map((item) => (
          <View
            key={item.id}
            style={{
              padding: spacing.lg,
              gap: spacing.md,
              borderRadius: radius.large,
              backgroundColor: colors.surface,
            }}>
            <Text style={{ color: colors.textPrimary, ...typography.cardTitle }}>
              {item.purchase_evaluations?.product_title ?? '之前聊过的商品'}
            </Text>
            <Text style={{ color: colors.textSecondary, ...typography.body }}>
              {item.kind === 'usage_checkin'
                ? '买回来以后，实际还在用吗？'
                : '之前说再等等，现在想法有变化吗？'}
            </Text>
            <Text style={{ color: colors.accent, ...typography.label }}>
              {followupLabel(item)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/(evaluation)',
                    params: { id: item.evaluation_id },
                  })
                }
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.pill,
                  backgroundColor: colors.textPrimary,
                  opacity: pressed ? 0.65 : 1,
                })}>
                <Text style={{ color: colors.onDark, fontWeight: '700' }}>
                  去看看
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={dismiss.isPending}
                onPress={() => dismiss.mutate(item.id)}
                style={({ pressed }) => ({
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceMuted,
                  opacity: pressed || dismiss.isPending ? 0.55 : 1,
                })}>
                <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>
                  忽略
                </Text>
              </Pressable>
            </View>
          </View>
        ))}

        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Text style={{ color: colors.textPrimary, ...typography.sectionTitle }}>
            Agent 记住的事
          </Text>
          <Text style={{ color: colors.textSecondary, ...typography.body }}>
            删除只影响跨对话引用，不会删除你的评估或资产。
          </Text>
        </View>

        {memories.isLoading ? <LoadingState /> : null}
        {memories.error ? <ErrorState message={memories.error.message} /> : null}
        {(memories.data ?? []).map((memory) => (
          <View
            key={memory.id}
            style={{
              padding: spacing.lg,
              gap: spacing.sm,
              borderRadius: radius.large,
              backgroundColor: colors.surface,
            }}>
            <Text style={{ color: colors.textPrimary, ...typography.cardTitle }}>
              {memory.facts.product_title ?? memory.summary}
            </Text>
            <Text style={{ color: colors.textSecondary, ...typography.body }}>
              {memoryDescription(memory)}
            </Text>
            <Text style={{ color: colors.textTertiary, ...typography.caption }}>
              {formatDate(memory.facts.created_at ?? memory.created_at)}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={forget.isPending}
              onPress={() => confirmForget(memory)}
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                paddingVertical: spacing.xs,
                opacity: pressed || forget.isPending ? 0.55 : 1,
              })}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                删除记忆
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </>
  );
}
