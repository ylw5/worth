import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';

import { resolveApiUrl } from '@/lib/api-url';
import type {
  EvaluationAsset,
  EvaluationChatMessage,
  ParsedProduct,
  PurchaseEvaluationResult,
} from '@/lib/evaluations';
import type {
  SellPlanAsset,
  SellPlanResult,
} from '@/lib/sell-plans';
import { parseSseEvent, splitSseBuffer } from '@/lib/sse';
import { supabase } from '@/lib/supabase';
import type { AssetInput, ValuationResult } from '@/types/domain';

const apiUrl = resolveApiUrl({
  explicitUrl: process.env.EXPO_PUBLIC_API_URL,
  developmentHosts: [
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.platform?.hostUri,
  ],
  webHostname:
    process.env.EXPO_OS === 'web' && typeof location !== 'undefined'
      ? location.hostname
      : undefined,
});

async function request<T>(path: string, body: unknown): Promise<T> {
  if (!apiUrl) {
    throw new Error('无法确定 API 地址，请配置 EXPO_PUBLIC_API_URL');
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw new Error('登录已失效，请重新登录');
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('网络连接失败，请稍后重试');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? '请求失败，请稍后重试');
  }
  return response.json() as Promise<T>;
}

export const analyzePhotos = (imageUrls: string[]) =>
  request<AssetInput>('/analyze', { image_urls: imageUrls });

export const estimateAsset = (asset: AssetInput) =>
  request<ValuationResult>('/estimate', asset);

export const parseProduct = (url: string) =>
  request<ParsedProduct>('/products/parse', { url });

export type ProductTextResult = {
  intent: 'product' | 'chat';
  product: ParsedProduct | null;
  reply: string;
};

export const normalizeProductText = (text: string, price: number | null) =>
  request<ProductTextResult>('/products/normalize-text', { text, price });

export const analyzeProductPhotos = (imageUrls: string[]) =>
  request<ParsedProduct>('/products/analyze-images', {
    image_urls: imageUrls,
  });

export const evaluatePurchase = (
  product: ParsedProduct,
  assets: EvaluationAsset[],
) =>
  request<PurchaseEvaluationResult>('/purchase-evaluations/evaluate', {
    product,
    assets,
  });

export const continuePurchaseEvaluation = (
  product: ParsedProduct,
  matchedAssets: EvaluationAsset[],
  facts: PurchaseEvaluationResult['facts'],
  messages: EvaluationChatMessage[],
) =>
  request<{ message: string }>('/purchase-evaluations/chat', {
    product,
    matched_assets: matchedAssets,
    facts,
    messages,
  });

export const recommendSellPlan = (
  targetPrice: number,
  assets: SellPlanAsset[],
) =>
  request<SellPlanResult>('/sell-plans/recommend', {
    target_price: targetPrice,
    assets,
  });

export async function streamPurchaseEvaluation(
  product: ParsedProduct,
  matchedAssets: EvaluationAsset[],
  facts: PurchaseEvaluationResult['facts'],
  messages: EvaluationChatMessage[],
  onDelta: (fullText: string) => void,
): Promise<string> {
  if (!apiUrl) {
    throw new Error('无法确定 API 地址，请配置 EXPO_PUBLIC_API_URL');
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    throw new Error('登录已失效，请重新登录');
  }

  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(
      `${apiUrl.replace(/\/$/, '')}/purchase-evaluations/chat/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          product,
          matched_assets: matchedAssets,
          facts,
          messages,
        }),
      },
    );
  } catch {
    throw new Error('网络连接失败，请稍后重试');
  }

  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { detail?: string }).detail ?? '请求失败，请稍后重试',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSseBuffer(buffer);
      buffer = rest;
      for (const raw of events) {
        const event = parseSseEvent(raw);
        if (!event) continue;
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'done') return fullText.trim();
        fullText += event.text;
        onDelta(fullText);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  if (fullText.trim()) return fullText.trim();
  throw new Error('评估对话暂时不可用，请稍后重试');
}
