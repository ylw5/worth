export type AgentProcessStep =
  | { kind: 'status'; status: 'thinking' | 'replying' }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      phase: 'started' | 'completed';
    };

export type CompletedProcessStep = { name: string; label: string };

export function visibleLiveProcessSteps(
  steps: ReadonlyArray<AgentProcessStep>,
): AgentProcessStep[] {
  const withoutReplying = steps.filter(
    (step) => !(step.kind === 'status' && step.status === 'replying'),
  );
  const hasTool = withoutReplying.some((step) => step.kind === 'tool');
  if (hasTool) {
    return withoutReplying.filter((step) => step.kind === 'tool');
  }
  let lastThinking: AgentProcessStep | null = null;
  for (const step of withoutReplying) {
    if (step.kind === 'status' && step.status === 'thinking') {
      lastThinking = step;
    }
  }
  return lastThinking ? [lastThinking] : [];
}

export function completedToolsFromProcessSteps(
  steps: ReadonlyArray<AgentProcessStep>,
): CompletedProcessStep[] {
  return steps
    .filter((step): step is Extract<AgentProcessStep, { kind: 'tool' }> =>
      step.kind === 'tool',
    )
    .map(({ name, label }) => ({ name, label }));
}

export function processSummaryLabel(count: number): string {
  return `已调用 ${count} 个步骤`;
}
