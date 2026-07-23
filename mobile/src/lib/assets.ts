import { supabase } from '@/lib/supabase';
import type {
  Asset,
  AssetInput,
  Valuation,
  ValuationResult,
} from '@/types/domain';

const bucket = supabase.storage.from('asset-photos');

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function withPhotoUrl(asset: Asset): Promise<Asset> {
  const { data, error } = await bucket.createSignedUrl(asset.photo_path, 3600);
  fail(error);
  return { ...asset, photo_url: data?.signedUrl };
}

export async function listAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return Promise.all(((data ?? []) as Asset[]).map(withPhotoUrl));
}

export async function getAsset(id: string): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('id', id)
    .single();
  fail(error);
  return withPhotoUrl(data as Asset);
}

export async function getValuations(assetId: string): Promise<Valuation[]> {
  const { data, error } = await supabase
    .from('valuations')
    .select('*')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false });
  fail(error);
  return (data ?? []) as Valuation[];
}

export async function uploadPhoto(
  base64: string,
  userId: string,
): Promise<{ path: string; signedUrl: string }> {
  const file = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
  const path = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.jpg`;
  const { error } = await bucket.upload(path, file, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  fail(error);
  const { data, error: signedUrlError } = await bucket.createSignedUrl(
    path,
    600,
  );
  fail(signedUrlError);
  if (!data?.signedUrl) throw new Error('无法读取照片');
  return { path, signedUrl: data.signedUrl };
}

export async function removePhoto(path: string) {
  const { error } = await bucket.remove([path]);
  fail(error);
}

export async function createAsset(
  userId: string,
  photoPath: string,
  input: AssetInput,
): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .insert({ ...input, user_id: userId, photo_path: photoPath })
    .select('*')
    .single();
  fail(error);
  return data as Asset;
}

export async function recordValuation(
  assetId: string,
  valuation: ValuationResult,
) {
  if (
    valuation.estimated_price === null ||
    valuation.price_low === null ||
    valuation.price_high === null
  ) {
    return;
  }
  const { error } = await supabase.rpc('record_valuation', {
    p_asset_id: assetId,
    p_estimated_price: valuation.estimated_price,
    p_price_low: valuation.price_low,
    p_price_high: valuation.price_high,
    p_sample_count: valuation.sample_count,
    p_query: valuation.query,
    p_sample_summary: valuation.sample_summary,
  });
  fail(error);
}
