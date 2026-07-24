import { supabase } from '@/lib/supabase';
import {
  parseEvaluationReply,
  stripEvaluationMarks,
} from '@/lib/spending-resolution-markers';
import { saveEvaluationReply } from '@/lib/spending-resolutions';
import type { AssetStatus, Category } from '@/types/domain';

export type ParsedProduct = {
  url: string;
  title: string;
  price: number | null;
  category: Category;
  subcategory: string;
  source_type: 'url' | 'text' | 'image';
  source_text: string;
};

export type EvaluationChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type StoredEvaluationMessage = EvaluationChatMessage & {
  id: string;
  evaluation_id: string;
  user_id: string;
  created_at: string;
};

export type EvaluationAsset = {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: Category;
  subcategory: string;
  status: AssetStatus;
};

export type EvaluationFacts = {
  total: number;
  in_use: number;
  idle: number;
  listed: number;
  sold: number;
};

export type PurchaseEvaluationResult = {
  product: ParsedProduct;
  matched_assets: EvaluationAsset[];
  facts: EvaluationFacts;
  narrative: string;
};

export type EvaluationDecision = 'pending' | 'buy' | 'skip';

export const evaluationDecisionLabels: Record<EvaluationDecision, string> = {
  pending: '进行中',
  buy: '建议买',
  skip: '建议不买',
};

export function stripDecisionMark(message: string): string {
  return stripEvaluationMarks(message);
}

export type PurchaseEvaluation = {
  id: string;
  user_id: string;
  product_url: string;
  product_title: string;
  product_price: number | null;
  category: Category;
  subcategory: string;
  matched_assets: EvaluationAsset[];
  facts: EvaluationFacts;
  narrative: string;
  parser_snapshot: { product?: ParsedProduct };
  source_type: 'url' | 'text' | 'image';
  source_text: string;
  image_paths: string[];
  image_urls?: string[];
  decision: EvaluationDecision;
  created_at: string;
  updated_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listEvaluationAssets(): Promise<EvaluationAsset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id,name,brand,model,category,subcategory,status')
    .order('created_at', { ascending: false });
  fail(error);
  return (data ?? []) as EvaluationAsset[];
}

export async function listPurchaseEvaluations(): Promise<
  PurchaseEvaluation[]
> {
  const { data, error } = await supabase
    .from('purchase_evaluations')
    .select('*')
    .order('updated_at', { ascending: false });
  fail(error);
  return (data ?? []) as PurchaseEvaluation[];
}

export async function getPurchaseEvaluation(
  id: string,
): Promise<PurchaseEvaluation> {
  const { data, error } = await supabase
    .from('purchase_evaluations')
    .select('*')
    .eq('id', id)
    .single();
  fail(error);
  const evaluation = data as PurchaseEvaluation;
  const image_urls = await Promise.all(
    (evaluation.image_paths ?? []).map(async (path) => {
      const { data: signed, error: signedError } = await supabase.storage
        .from('asset-photos')
        .createSignedUrl(path, 3600);
      fail(signedError);
      return signed?.signedUrl ?? '';
    }),
  );
  return { ...evaluation, image_urls };
}

export async function createPurchaseEvaluation(
  userId: string,
  result: PurchaseEvaluationResult,
  options: { imagePaths?: string[] } = {},
): Promise<PurchaseEvaluation> {
  const { product } = result;
  const parsed = parseEvaluationReply(result.narrative);
  const { data, error } = await supabase
    .from('purchase_evaluations')
    .insert({
      user_id: userId,
      product_url: product.url,
      product_title: product.title,
      product_price: product.price,
      category: product.category,
      subcategory: product.subcategory,
      matched_assets: result.matched_assets,
      facts: result.facts,
      narrative: parsed.cleaned,
      parser_snapshot: { product },
      source_type: product.source_type,
      source_text: product.source_text,
      image_paths: options.imagePaths ?? [],
    })
    .select('*')
    .single();
  fail(error);
  const evaluation = data as PurchaseEvaluation;
  try {
    await saveEvaluationReply(evaluation.id, result.narrative);
  } catch (caught) {
    await supabase
      .from('purchase_evaluations')
      .delete()
      .eq('id', evaluation.id);
    throw caught;
  }
  return evaluation;
}

export async function listEvaluationMessages(
  evaluationId: string,
): Promise<StoredEvaluationMessage[]> {
  const { data, error } = await supabase
    .from('evaluation_messages')
    .select('*')
    .eq('evaluation_id', evaluationId)
    .order('created_at', { ascending: true });
  fail(error);
  return (data ?? []) as StoredEvaluationMessage[];
}

export async function createEvaluationMessage(
  evaluationId: string,
  userId: string,
  role: EvaluationChatMessage['role'],
  content: string,
): Promise<StoredEvaluationMessage> {
  const { data, error } = await supabase
    .from('evaluation_messages')
    .insert({
      evaluation_id: evaluationId,
      user_id: userId,
      role,
      content: content.trim(),
    })
    .select('*')
    .single();
  fail(error);
  return data as StoredEvaluationMessage;
}

export function productFromEvaluation(
  evaluation: PurchaseEvaluation,
): ParsedProduct {
  return {
    url: evaluation.product_url,
    title: evaluation.product_title,
    price: evaluation.product_price,
    category: evaluation.category,
    subcategory: evaluation.subcategory,
    source_type: evaluation.source_type ?? 'url',
    source_text: evaluation.source_text ?? '',
  };
}
