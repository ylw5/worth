import type {
  SellPlanAsset,
  SellPlanAssetSource,
} from '@/lib/sell-plans';

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toSellPlanAssets(
  assets: SellPlanAssetSource[],
): SellPlanAsset[] {
  return assets.flatMap((asset) => {
    if (
      !['idle', 'listed'].includes(asset.status) ||
      asset.latest_market_price === null
    ) {
      return [];
    }
    return [
      {
        id: asset.id,
        name: asset.name,
        status: asset.status,
        estimated_price: asset.latest_market_price,
        price_low: asset.latest_market_price_low,
        latest_valuation_at: asset.latest_valuation_at,
      },
    ];
  });
}
