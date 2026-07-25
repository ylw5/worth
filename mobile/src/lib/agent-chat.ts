import * as Crypto from 'expo-crypto';

import { supabase } from '@/lib/supabase';

export type AgentThread = {
  id: string;
  user_id: string;
  thread_key: string;
  kind: 'general' | 'purchase_evaluation';
  evaluation_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AgentThreadListItem = AgentThread & {
  latest_decision: 'pending' | 'buy' | 'skip' | null;
};

export type AgentMessage = {
  id: string;
  thread_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  route_result: Record<string, unknown>;
  created_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function createAgentThread(
  userId: string,
  title: string,
): Promise<AgentThread> {
  const threadKey = Crypto.randomUUID();
  const trimmed = title.trim().slice(0, 40) || '聊天';
  const { data, error } = await supabase
    .from('agent_threads')
    .insert({
      user_id: userId,
      thread_key: threadKey,
      kind: 'general',
      title: trimmed,
    })
    .select('*')
    .single();
  fail(error);
  return data as AgentThread;
}

export async function createPurchaseEvaluationThread(
  userId: string,
  title: string,
): Promise<AgentThread> {
  const threadKey = Crypto.randomUUID();
  const trimmed = title.trim().slice(0, 40) || '购买评估';
  const { data, error } = await supabase
    .from('agent_threads')
    .insert({
      user_id: userId,
      thread_key: threadKey,
      kind: 'purchase_evaluation',
      title: trimmed,
    })
    .select('*')
    .single();
  fail(error);
  return data as AgentThread;
}

export async function getOrCreateGeneralThread(
  userId: string,
): Promise<AgentThread> {
  const { data, error } = await supabase
    .from('agent_threads')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'general')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(error);
  if (data) return data as AgentThread;
  return createAgentThread(userId, '聊天');
}

export async function listAgentThreads(): Promise<AgentThreadListItem[]> {
  const { data: threads, error } = await supabase
    .from('agent_threads')
    .select('*')
    .order('updated_at', { ascending: false });
  fail(error);
  const list = (threads ?? []) as AgentThread[];
  if (!list.length) return [];

  const ids = list.map((t) => t.id);
  const { data: evaluations, error: evalError } = await supabase
    .from('purchase_evaluations')
    .select('thread_id, decision, updated_at')
    .in('thread_id', ids)
    .order('updated_at', { ascending: false });
  fail(evalError);

  const latestDecision = new Map<string, 'pending' | 'buy' | 'skip'>();
  for (const row of evaluations ?? []) {
    if (!latestDecision.has(row.thread_id)) {
      latestDecision.set(row.thread_id, row.decision ?? 'pending');
    }
  }

  return list.map((thread) => ({
    ...thread,
    latest_decision: latestDecision.get(thread.id) ?? null,
  }));
}

export async function updateAgentThreadTitle(
  threadId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim().slice(0, 40) || '聊天';
  const { error } = await supabase
    .from('agent_threads')
    .update({ title: trimmed })
    .eq('id', threadId);
  fail(error);
}

export async function getThreadIdForEvaluation(
  evaluationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('purchase_evaluations')
    .select('thread_id')
    .eq('id', evaluationId)
    .maybeSingle();
  fail(error);
  return data?.thread_id ?? null;
}

export async function listAgentMessages(
  threadId: string,
): Promise<AgentMessage[]> {
  const { data, error } = await supabase
    .from('agent_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  fail(error);
  return (data ?? []) as AgentMessage[];
}

export async function createAgentMessage(
  threadId: string,
  userId: string,
  role: AgentMessage['role'],
  content: string,
  routeResult: Record<string, unknown> = {},
): Promise<AgentMessage> {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({
      thread_id: threadId,
      user_id: userId,
      role,
      content: content.trim(),
      route_result: routeResult,
    })
    .select('*')
    .single();
  fail(error);
  return data as AgentMessage;
}
