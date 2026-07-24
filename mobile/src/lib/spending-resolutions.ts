import { parseEvaluationReply } from '@/lib/spending-resolution-markers';
import { supabase } from '@/lib/supabase';

export type SpendingResolution = {
  id: string;
  user_id: string;
  evaluation_id: string;
  message_id: string;
  amount: number;
  product_snapshot: {
    url: string;
    title: string;
    price: number | null;
    category: string;
    subcategory: string;
    source_type: 'url' | 'text' | 'image';
    source_text: string;
  };
  image_paths: string[];
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

export type ConfirmedSpendingResolution = SpendingResolution & {
  confirmed_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function saveEvaluationReply(
  evaluationId: string,
  rawMessage: string,
): Promise<string> {
  const parsed = parseEvaluationReply(rawMessage);
  const { data, error } = await supabase.rpc('save_evaluation_reply', {
    p_evaluation_id: evaluationId,
    p_content: parsed.cleaned,
    p_decision: parsed.decision,
    p_amount: parsed.resolutionAmount,
  });
  fail(error);
  return data as string;
}

export async function getSpendingResolution(
  evaluationId: string,
): Promise<SpendingResolution | null> {
  const { data, error } = await supabase
    .from('spending_resolutions')
    .select('*')
    .eq('evaluation_id', evaluationId)
    .maybeSingle();
  fail(error);
  return data as SpendingResolution | null;
}

export async function confirmSpendingResolution(
  resolutionId: string,
): Promise<SpendingResolution> {
  const { data, error } = await supabase
    .rpc('confirm_spending_resolution', {
      p_resolution_id: resolutionId,
    })
    .single();
  fail(error);
  return data as SpendingResolution;
}

export async function listConfirmedSpendingResolutions(): Promise<
  ConfirmedSpendingResolution[]
> {
  const { data, error } = await supabase
    .from('spending_resolutions')
    .select('*')
    .not('confirmed_at', 'is', null)
    .order('confirmed_at', { ascending: false });
  fail(error);
  return ((data ?? []) as ConfirmedSpendingResolution[]).map((resolution) => ({
    ...resolution,
    amount: Number(resolution.amount),
  }));
}
