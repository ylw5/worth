export function getAssetGridColumns(width: number): 2 | 3 | 4 {
  if (width >= 1000) return 4;
  if (width >= 700) return 3;
  return 2;
}
