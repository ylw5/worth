import type { Asset, AssetInput } from '@/types/domain';

type Recognition = Omit<AssetInput, 'purchase_date' | 'purchase_price'>;
export type ProtectedField = keyof Recognition;

export function mergeRecognition(
  current: AssetInput,
  incoming: Recognition,
  protectedFields: ReadonlySet<ProtectedField>,
): AssetInput {
  return {
    ...current,
    name: protectedFields.has('name') ? current.name : incoming.name,
    brand: protectedFields.has('brand') ? current.brand : incoming.brand,
    model: protectedFields.has('model') ? current.model : incoming.model,
    specs: protectedFields.has('specs') ? current.specs : incoming.specs,
    category: protectedFields.has('category')
      ? current.category
      : incoming.category,
    subcategory: protectedFields.has('subcategory')
      ? current.subcategory
      : incoming.subcategory,
    condition: protectedFields.has('condition')
      ? current.condition
      : incoming.condition,
    search_query: protectedFields.has('search_query')
      ? current.search_query
      : incoming.search_query,
  };
}

export function getAssetCoverUrl(
  asset: Pick<
    Asset,
    'photo_paths' | 'photo_urls' | 'photo_cutout_urls'
  >,
) {
  const coverPath = asset.photo_paths[0];
  return (
    (coverPath ? asset.photo_cutout_urls?.[coverPath] : undefined) ??
    asset.photo_urls?.[0]
  );
}
