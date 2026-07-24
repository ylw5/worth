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
