import { supabase } from '@/lib/supabase';
import type { AssetStatus } from '@/lib/asset-status';
import type {
  Asset,
  AssetSale,
  AssetWriteInput,
  Valuation,
  ValuationResult,
} from '@/types/domain';

const bucket = supabase.storage.from('asset-photos');

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function withPhotoUrls(asset: Asset): Promise<Asset> {
  const signedUrl = async (path: string) => {
    const { data, error } = await bucket.createSignedUrl(path, 3600);
    fail(error);
    return data?.signedUrl ?? '';
  };
  const cutoutPaths = asset.photo_cutout_paths ?? {};
  const [photo_urls, cutoutEntries] = await Promise.all([
    Promise.all(asset.photo_paths.map(signedUrl)),
    Promise.all(
      Object.entries(cutoutPaths).map(
        async ([photoPath, cutoutPath]) =>
          [photoPath, await signedUrl(cutoutPath)] as const,
      ),
    ),
  ]);
  return {
    ...asset,
    photo_cutout_paths: cutoutPaths,
    photo_urls,
    photo_cutout_urls: Object.fromEntries(cutoutEntries),
  };
}

export async function listAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return Promise.all(((data ?? []) as Asset[]).map(withPhotoUrls));
}

export async function getAsset(id: string): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('id', id)
    .single();
  fail(error);
  return withPhotoUrls(data as Asset);
}

export async function getAssetSale(assetId: string): Promise<AssetSale | null> {
  const { data, error } = await supabase
    .from('asset_sales')
    .select('*')
    .eq('asset_id', assetId)
    .maybeSingle();
  fail(error);
  return data as AssetSale | null;
}

export async function setAssetStatus(
  id: string,
  status: Exclude<AssetStatus, 'sold'>,
) {
  const { error } = await supabase.rpc('set_asset_status', {
    p_asset_id: id,
    p_status: status,
  });
  fail(error);
}

export async function recordAssetSale(
  id: string,
  soldAt: string,
  salePrice: number,
) {
  const { error } = await supabase.rpc('record_asset_sale', {
    p_asset_id: id,
    p_sold_at: soldAt,
    p_sale_price: salePrice,
  });
  fail(error);
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

async function uploadImage(
  base64: string,
  userId: string,
  extension: 'jpg' | 'png',
): Promise<{ path: string; signedUrl: string }> {
  const file = Uint8Array.from(atob(base64), (byte) => byte.charCodeAt(0));
  const path = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;
  const { error } = await bucket.upload(path, file, {
    contentType: extension === 'png' ? 'image/png' : 'image/jpeg',
    upsert: false,
  });
  fail(error);
  const { data, error: signedUrlError } = await bucket.createSignedUrl(
    path,
    600,
  );
  if (signedUrlError || !data?.signedUrl) {
    await bucket.remove([path]).catch(() => undefined);
    fail(signedUrlError);
    throw new Error('无法读取照片');
  }
  return { path, signedUrl: data.signedUrl };
}

export const uploadPhoto = (base64: string, userId: string) =>
  uploadImage(base64, userId, 'jpg');

export const uploadCover = (base64: string, userId: string) =>
  uploadImage(base64, userId, 'png');

export async function removePhotos(paths: string[]) {
  if (!paths.length) return;
  const { error } = await bucket.remove(paths);
  fail(error);
}

export async function uploadPhotos(base64Images: string[], userId: string) {
  if (
    base64Images.length < 1 ||
    base64Images.length > 5 ||
    base64Images.some((image) => !image)
  ) {
    throw new Error('每件物品需要 1–5 张有效照片');
  }
  const results = await Promise.allSettled(
    base64Images.map((image) => uploadPhoto(image, userId)),
  );
  const uploaded = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) {
    await removePhotos(uploaded.map((item) => item.path)).catch(() => undefined);
    throw failed.reason;
  }
  return uploaded;
}

export async function createAsset(
  userId: string,
  photoPaths: string[],
  input: AssetWriteInput,
  photoCutoutPaths: Record<string, string> = {},
): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .insert({
      ...input,
      user_id: userId,
      photo_paths: photoPaths,
      photo_cutout_paths: photoCutoutPaths,
    })
    .select('*')
    .single();
  fail(error);
  return data as Asset;
}

export async function updateAsset(
  id: string,
  input: AssetWriteInput,
  photoPaths?: string[],
  photoCutoutPaths?: Record<string, string>,
): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .update({
      ...input,
      ...(photoPaths ? { photo_paths: photoPaths } : {}),
      ...(photoCutoutPaths
        ? { photo_cutout_paths: photoCutoutPaths }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
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
