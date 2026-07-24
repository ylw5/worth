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

export function setCover(photos: AssetPhoto[], index: number) {
  if (index === 0) return photos;
  return [photos[index], ...photos.slice(0, index), ...photos.slice(index + 1)];
}
