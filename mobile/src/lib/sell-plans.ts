import { supabase } from '@/lib/supabase';
import { localDateKey } from '@/lib/sell-plan-helpers';
import type { AssetInput, AssetStatus } from '@/types/domain';

export type SellPlanAssetSource = AssetInput & {
  id: string;
  status: AssetStatus;
  latest_market_price: number | null;
  latest_market_price_low: number | null;
  latest_market_price_high: number | null;
  latest_valuation_at: string | null;
};

export type SellPlanAsset = {
  id: string;
  name: string;
  status: AssetStatus;
  estimated_price: number;
  price_low: number | null;
  latest_valuation_at: string | null;
};

export type SellPlanItem = {
  id: string;
  name: string;
  status: AssetStatus;
  conservative_price: number;
  latest_valuation_at: string | null;
};

export type SellPlanResult = {
  target_price: number;
  estimated_total: number;
  coverage_ratio: number;
  is_reachable: boolean;
  items: SellPlanItem[];
};

export type SellPlanSnapshot = {
  id: string;
  user_id: string;
  wishlist_item_id: string;
  plan_date: string;
  target_price: number;
  estimated_total: number;
  coverage_ratio: number;
  is_reachable: boolean;
  items: SellPlanItem[];
  refresh_failures: number;
  created_at: string;
  updated_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listSellableAssetSources(): Promise<
  SellPlanAssetSource[]
> {
  const { data, error } = await supabase
    .from('assets')
    .select(
      'id,name,brand,model,specs,category,subcategory,status,condition,search_query,latest_market_price,latest_market_price_low,latest_market_price_high,latest_valuation_at',
    )
    .in('status', ['idle', 'listed'])
    .order('updated_at', { ascending: false });
  fail(error);
  return (data ?? []) as SellPlanAssetSource[];
}

export async function getDailySellPlan(
  wishlistItemId: string,
  planDate = localDateKey(),
): Promise<SellPlanSnapshot | null> {
  const { data, error } = await supabase
    .from('sell_plan_snapshots')
    .select('*')
    .eq('wishlist_item_id', wishlistItemId)
    .eq('plan_date', planDate)
    .maybeSingle();
  fail(error);
  return data as SellPlanSnapshot | null;
}

export async function listSellPlanHistory(
  wishlistItemId: string,
): Promise<SellPlanSnapshot[]> {
  const { data, error } = await supabase
    .from('sell_plan_snapshots')
    .select('*')
    .eq('wishlist_item_id', wishlistItemId)
    .lt('plan_date', localDateKey())
    .order('plan_date', { ascending: false });
  fail(error);
  return (data ?? []) as SellPlanSnapshot[];
}

export async function saveDailySellPlan(
  userId: string,
  wishlistItemId: string,
  result: SellPlanResult,
  refreshFailures = 0,
  planDate = localDateKey(),
): Promise<SellPlanSnapshot> {
  const { data, error } = await supabase
    .from('sell_plan_snapshots')
    .upsert(
      {
        user_id: userId,
        wishlist_item_id: wishlistItemId,
        plan_date: planDate,
        target_price: result.target_price,
        estimated_total: result.estimated_total,
        coverage_ratio: result.coverage_ratio,
        is_reachable: result.is_reachable,
        items: result.items,
        refresh_failures: refreshFailures,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,wishlist_item_id,plan_date' },
    )
    .select('*')
    .single();
  fail(error);
  return data as SellPlanSnapshot;
}
