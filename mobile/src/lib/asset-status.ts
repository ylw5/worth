export const assetStatuses = ['in_use', 'idle', 'listed', 'sold'] as const;

export type AssetStatus = (typeof assetStatuses)[number];

export const assetStatusLabels: Record<AssetStatus, string> = {
  in_use: '持有',
  idle: '闲置',
  listed: '出售中',
  sold: '已卖出',
};

export const isCurrentAsset = (asset: { status: AssetStatus }) =>
  asset.status !== 'sold';

export const matchesAssetFilters = (
  asset: { status: AssetStatus; category: string },
  status: AssetStatus | null,
  category: string | null,
) =>
  (status === null || asset.status === status) &&
  (category === null || asset.category === category);
