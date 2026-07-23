export const maxAssetPhotos = 5;

export type AssetPhoto = {
  id: string;
  uri: string;
  base64?: string;
  path?: string;
  analysisUrl?: string;
};

export function setCover(photos: AssetPhoto[], index: number) {
  if (index === 0) return photos;
  return [photos[index], ...photos.slice(0, index), ...photos.slice(index + 1)];
}
