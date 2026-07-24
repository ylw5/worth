import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/colors';
import { completeEvaluationFollowup } from '@/lib/agent-memory';
import {
  evaluationOutcomeLabels,
  evaluationUserChoiceLabels,
  recordPurchaseOutcome,
  type EvaluationOutcomeStatus,
  type EvaluationUserChoice,
  type PurchaseEvaluation,
} from '@/lib/evaluations';

const choices = ['buy', 'skip', 'postponed'] as const;
const outcomes = ['in_use', 'idle', 'listed', 'returned', 'sold'] as const;

export function PurchaseOutcomeControls({
  evaluation,
}: {
  evaluation: PurchaseEvaluation;
}) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['purchase-evaluation', evaluation.id],
      }),
      queryClient.invalidateQueries({ queryKey: ['purchase-evaluations'] }),
      queryClient.invalidateQueries({ queryKey: ['agent-memories'] }),
      queryClient.invalidateQueries({ queryKey: ['agent-followups'] }),
    ]);
  };
  const save = useMutation({
    mutationFn: async ({
      choice,
      outcome,
      completeKind,
    }: {
      choice: EvaluationUserChoice;
      outcome: EvaluationOutcomeStatus;
      completeKind?: 'decision_checkin' | 'usage_checkin';
    }) => {
      await recordPurchaseOutcome(
        evaluation.id,
        choice,
        outcome,
        evaluation.linked_asset_id,
      );
      if (completeKind) {
        await completeEvaluationFollowup(evaluation.id, completeKind);
      }
    },
    onSuccess: refresh,
  });

  return (
    <View
      style={{
        padding: spacing.lg,
        gap: spacing.md,
        borderRadius: radius.large,
        backgroundColor: colors.surface,
      }}>
      <Text style={{ color: colors.textPrimary, ...typography.cardTitle }}>
        你后来怎么选的？
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {choices.map((choice) => {
          const selected = evaluation.user_choice === choice;
          return (
            <ChoiceChip
              key={choice}
              label={evaluationUserChoiceLabels[choice]}
              selected={selected}
              disabled={save.isPending}
              onPress={() =>
                save.mutate({
                  choice,
                  outcome:
                    choice === 'skip'
                      ? 'not_bought'
                      : evaluation.outcome_status === 'not_bought'
                        ? 'unknown'
                        : evaluation.outcome_status,
                  completeKind:
                    choice === 'buy' || choice === 'skip'
                      ? 'decision_checkin'
                      : undefined,
                })
              }
            />
          );
        })}
      </View>

      {evaluation.user_choice === 'buy' ? (
        <>
          <Text style={{ color: colors.textSecondary, ...typography.label }}>
            买回来以后，现在怎么样？
          </Text>
          <View
            style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {outcomes.map((outcome) => (
              <ChoiceChip
                key={outcome}
                label={evaluationOutcomeLabels[outcome]}
                selected={evaluation.outcome_status === outcome}
                disabled={save.isPending}
                onPress={() =>
                  save.mutate({
                    choice: 'buy',
                    outcome,
                    completeKind: 'usage_checkin',
                  })
                }
              />
            ))}
          </View>
        </>
      ) : null}
      {save.error ? (
        <Text style={{ color: colors.danger, ...typography.label }}>
          {save.error.message}
        </Text>
      ) : null}
    </View>
  );
}

function ChoiceChip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentSoft : colors.background,
        opacity: pressed || disabled ? 0.55 : 1,
      })}>
      <Text
        style={{
          color: selected ? colors.accent : colors.textPrimary,
          fontWeight: '700',
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
