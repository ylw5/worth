export type EvaluationStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export function splitSseBuffer(buffer: string): {
  events: string[];
  rest: string;
} {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { events: parts.filter((part) => part.trim()), rest };
}

export function parseSseEvent(raw: string): EvaluationStreamEvent | null {
  const data = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data) return null;
  if (data === '[DONE]') return { type: 'done' };
  try {
    const payload = JSON.parse(data) as { delta?: string; error?: string };
    if (typeof payload.error === 'string') {
      return { type: 'error', message: payload.error };
    }
    if (typeof payload.delta === 'string') {
      return { type: 'delta', text: payload.delta };
    }
  } catch {
    return null;
  }
  return null;
}
