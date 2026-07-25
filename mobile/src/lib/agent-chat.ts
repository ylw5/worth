import type { EvaluationChatMessage } from '@/lib/evaluations';
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

export type AgentMessage = EvaluationChatMessage & {
  id: string;
  thread_id: string;
  user_id: string;
  route_result: Record<string, unknown>;
  created_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function getOrCreateGeneralThread(
  userId: string,
): Promise<AgentThread> {
  const { data, error } = await supabase
    .from('agent_threads')
    .upsert(
      {
        user_id: userId,
        thread_key: 'general',
        kind: 'general',
        title: '随便聊聊',
      },
      { onConflict: 'user_id,thread_key' },
    )
    .select('*')
    .single();
  fail(error);
  return data as AgentThread;
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
  role: EvaluationChatMessage['role'],
  content: string,
): Promise<AgentMessage> {
  const { data, error } = await supabase
    .from('agent_messages')
    .insert({
      thread_id: threadId,
      user_id: userId,
      role,
      content: content.trim(),
    })
    .select('*')
    .single();
  fail(error);
  return data as AgentMessage;
}
