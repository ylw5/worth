import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';
import type {
  AssetInput,
  AssetWriteInput,
  ValuationResult,
} from '@/types/domain';

const metroApiHost = Constants.expoConfig?.hostUri?.replace(/:\d+$/, ':8000');
const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  (metroApiHost ? `http://${metroApiHost}` : undefined);

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

type RecognitionInput = Omit<
  AssetInput,
  'purchase_date' | 'purchase_price'
>;

export const analyzePhotos = async (
  imageUrls: string[],
  currentAsset?: AssetInput,
) => ({
  ...(await request<RecognitionInput>('/analyze', {
    image_urls: imageUrls,
    current_asset: currentAsset
      ? {
          name: currentAsset.name,
          brand: currentAsset.brand,
          model: currentAsset.model,
          specs: currentAsset.specs,
          category: currentAsset.category,
          condition: currentAsset.condition,
          search_query: currentAsset.search_query,
        }
      : null,
  })),
  purchase_date: '',
  purchase_price: '',
});

export async function cutoutPhoto(imageUrl: string) {
  const result = await request<{ image_base64: string | null }>('/cutout', {
    image_url: imageUrl,
  });
  return result.image_base64;
}

export const estimateAsset = (asset: AssetInput | AssetWriteInput) =>
  request<ValuationResult>('/estimate', {
    name: asset.name,
    brand: asset.brand,
    model: asset.model,
    specs: asset.specs,
    category: asset.category,
    condition: asset.condition,
    search_query: asset.search_query,
  });
