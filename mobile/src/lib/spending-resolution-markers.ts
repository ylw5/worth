export type ReplyDecision = 'buy' | 'skip';

export type ParsedEvaluationReply = {
  decision: ReplyDecision | null;
  resolutionAmount: number | null;
  cleaned: string;
};

const decisionPattern = /\s*\[decision:(buy|skip)\]\s*/gi;
const resolutionPattern = /\s*\[spending_resolution:([^\]]*)\]\s*/gi;

export function parseEvaluationReply(
  message: string,
): ParsedEvaluationReply {
  let decision: ReplyDecision | null = null;
  let resolutionAmount: number | null = null;
  let cleaned = message.replace(decisionPattern, (_, value: string) => {
    decision = value.toLowerCase() as ReplyDecision;
    return '\n';
  });
  cleaned = cleaned.replace(resolutionPattern, (_, value: string) => {
    if (/^\d+(?:\.\d{1,2})?$/.test(value)) {
      const amount = Number(value);
      if (amount > 0 && amount <= 9_999_999_999.99) {
        resolutionAmount = amount;
      }
    }
    return '\n';
  });
  return {
    decision,
    resolutionAmount: decision === 'skip' ? resolutionAmount : null,
    cleaned: cleaned.trim(),
  };
}

export function stripEvaluationMarks(message: string): string {
  return parseEvaluationReply(message).cleaned;
}
