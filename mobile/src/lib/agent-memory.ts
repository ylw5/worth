import { supabase } from '@/lib/supabase';
import type {
  EvaluationOutcomeStatus,
  EvaluationUserChoice,
} from '@/lib/evaluations';

export type AgentMemory = {
  id: string;
  user_id: string;
  memory_type: 'purchase_episode' | 'preference' | 'pattern';
  summary: string;
  facts: {
    id?: string;
    product_title?: string;
    product_price?: number | null;
    category?: string;
    subcategory?: string;
    user_choice?: EvaluationUserChoice;
    outcome_status?: EvaluationOutcomeStatus;
    linked_asset_id?: string | null;
    created_at?: string;
  };
  source_evaluation_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AgentFollowup = {
  id: string;
  user_id: string;
  evaluation_id: string;
  kind: 'decision_checkin' | 'usage_checkin';
  due_at: string;
  status: 'pending' | 'completed' | 'dismissed';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  purchase_evaluations: {
    product_title: string;
    user_choice: EvaluationUserChoice;
    outcome_status: EvaluationOutcomeStatus;
  } | null;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listAgentMemories(): Promise<AgentMemory[]> {
  const { data, error } = await supabase
    .from('agent_memories')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false });
  fail(error);
  return (data ?? []) as AgentMemory[];
}

export async function forgetAgentMemory(memoryId: string): Promise<void> {
  const { error } = await supabase.rpc('set_agent_memory_active', {
    p_memory_id: memoryId,
    p_is_active: false,
  });
  fail(error);
}

export async function listPendingFollowups(): Promise<AgentFollowup[]> {
  const { data, error } = await supabase
    .from('agent_followups')
    .select(
      '*, purchase_evaluations(product_title,user_choice,outcome_status)',
    )
    .eq('status', 'pending')
    .order('due_at', { ascending: true });
  fail(error);
  return (data ?? []) as AgentFollowup[];
}

export async function dismissAgentFollowup(
  followupId: string,
): Promise<void> {
  const { error } = await supabase.rpc('update_agent_followup', {
    p_followup_id: followupId,
    p_status: 'dismissed',
  });
  fail(error);
}

export async function completeEvaluationFollowup(
  evaluationId: string,
  kind: AgentFollowup['kind'],
): Promise<void> {
  const { error } = await supabase.rpc('complete_evaluation_followup', {
    p_evaluation_id: evaluationId,
    p_kind: kind,
  });
  fail(error);
}
