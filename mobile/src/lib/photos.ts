export const maxAssetPhotos = 5;

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed';

export type AssetPhoto = {
  id: string;
  uri: string;
  base64?: string;
  path?: string;
  analysisUrl?: string;
  cutoutPath?: string;
  cutoutUrl?: string;
  recognitionStatus?: ProcessingStatus;
  cutoutStatus?: ProcessingStatus;
};

type PickerAsset = {
  uri: string;
  base64?: string | null;
};

export function pickerAssetsToPhotos(
  assets: PickerAsset[],
  limit: number,
  timestamp = Date.now(),
) {
  return assets.slice(0, limit).flatMap((asset, index) =>
    asset.base64
      ? [
          {
            id: `${asset.uri}-${timestamp}-${index}`,
            uri: asset.uri,
            base64: asset.base64,
          },
        ]
      : [],
  );
}

export function setCover(photos: AssetPhoto[], index: number) {
  if (index === 0) return photos;
  return [photos[index], ...photos.slice(0, index), ...photos.slice(index + 1)];
}
