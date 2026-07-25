export type AgentChatStreamEvent =
  | { type: 'status'; status: 'thinking' | 'replying' }
  | {
      type: 'tool';
      name: string;
      label: string;
      phase: 'started' | 'completed';
    }
  | { type: 'delta'; text: string }
  | { type: 'done'; evaluationId: string | null }
  | { type: 'error'; message: string };

export type EvaluationStreamEvent = AgentChatStreamEvent;

export function splitSseBuffer(buffer: string): {
  events: string[];
  rest: string;
} {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts.filter((part) => part.trim()), rest };
}

export function parseSseEvent(raw: string): AgentChatStreamEvent | null {
  const data = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data) return null;
  if (data === '[DONE]') return { type: 'done', evaluationId: null };
  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (typeof payload.error === 'string') {
      return { type: 'error', message: payload.error };
    }
    if (payload.status === 'thinking' || payload.status === 'replying') {
      return { type: 'status', status: payload.status };
    }
    if (
      (payload.phase === 'started' || payload.phase === 'completed') &&
      typeof payload.name === 'string' &&
      typeof payload.label === 'string'
    ) {
      return {
        type: 'tool',
        name: payload.name,
        label: payload.label,
        phase: payload.phase,
      };
    }
    if ('evaluation_id' in payload) {
      const evaluationId = payload.evaluation_id;
      return {
        type: 'done',
        evaluationId:
          evaluationId === null || evaluationId === undefined
            ? null
            : String(evaluationId),
      };
    }
    if (typeof payload.delta === 'string') {
      return { type: 'delta', text: payload.delta };
    }
  } catch {
    return null;
  }
  return null;
}
