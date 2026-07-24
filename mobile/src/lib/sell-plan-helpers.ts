import type {
  SellPlanAsset,
  SellPlanAssetSource,
  SellPlanSnapshot,
} from '@/lib/sell-plans';

export type SellPlanReadiness = {
  eligible: SellPlanAssetSource[];
  valuedEligible: SellPlanAssetSource[];
  needsValuation: SellPlanAssetSource[];
  inUseValued: SellPlanAssetSource[];
  inUseNeedsValuation: SellPlanAssetSource[];
};

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

export function inspectSellPlanReadiness(
  assets: SellPlanAssetSource[],
): SellPlanReadiness {
  const eligible = assets.filter((asset) =>
    ['idle', 'listed'].includes(asset.status),
  );
  const hasValuation = (asset: SellPlanAssetSource) =>
    asset.latest_market_price !== null &&
    asset.latest_market_price > 0;
  const inUse = assets.filter((asset) => asset.status === 'in_use');

  return {
    eligible,
    valuedEligible: eligible.filter(hasValuation),
    needsValuation: eligible.filter((asset) => !hasValuation(asset)),
    inUseValued: inUse.filter(hasValuation),
    inUseNeedsValuation: inUse.filter((asset) => !hasValuation(asset)),
  };
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sellPlanSourceVersion(assets: SellPlanAssetSource[]) {
  return assets.reduce(
    (latest, asset) =>
      Math.max(
        latest,
        timestamp(asset.updated_at),
        timestamp(asset.latest_valuation_at),
      ),
    0,
  );
}

export function isSellPlanSnapshotCurrent(
  snapshot: SellPlanSnapshot,
  targetPrice: number,
  assets: SellPlanAssetSource[],
) {
  return (
    snapshot.target_price === targetPrice &&
    timestamp(snapshot.updated_at) >= sellPlanSourceVersion(assets)
  );
}
