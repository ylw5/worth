import type { AssetStatus } from '@/lib/asset-status';

export const categories = [
  '数码',
  '家电',
  '家具',
  '服饰箱包',
  '珠宝腕表',
  '收藏',
  '交通工具',
  '其他',
] as const;

export type Category = (typeof categories)[number];

export const conditions = [
  '全新未使用',
  '几乎全新',
  '轻微使用痕迹',
  '明显使用痕迹',
  '重度使用或有瑕疵',
  '无法判断',
] as const;

export type Condition = (typeof conditions)[number];

export type AssetInput = {
  name: string;
  brand: string;
  model: string;
  specs: Record<string, string>;
  category: Category;
  condition: Condition;
  search_query: string;
  purchase_date: string;
  purchase_price: string;
};

export type AssetWriteInput = Omit<
  AssetInput,
  'purchase_date' | 'purchase_price'
> & {
  purchase_date: string | null;
  purchase_price: number | null;
};

export type Asset = AssetWriteInput & {
  id: string;
  user_id: string;
  market_key: string;
  subcategory: string;
  photo_paths: string[];
  photo_urls?: string[];
  photo_cutout_paths: Record<string, string>;
  photo_cutout_urls?: Record<string, string>;
  status: AssetStatus;
  latest_market_price: number | null;
  latest_market_price_low: number | null;
  latest_market_price_high: number | null;
  latest_valuation_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetSale = {
  id: string;
  asset_id: string;
  user_id: string;
  sold_at: string;
  sale_price: number;
  platform: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type MarketSample = {
  item_id: string;
  title: string;
  price: number;
  url: string;
};

export type ValuationResult = {
  estimated_price: number | null;
  price_low: number | null;
  price_high: number | null;
  sample_count: number;
  query: string;
  sample_summary: MarketSample[];
};

export type Valuation = ValuationResult & {
  id: string;
  asset_id: string;
  created_at: string;
};

export type MarketSnapshot = {
  id: string;
  asset_id: string;
  snapshot_date: string;
  estimated_price: number;
  price_low: number;
  price_high: number;
  sample_count: number;
  query: string;
  source: 'xianyu_active_listings';
  created_at: string;
};

export type AnalysisRun = {
  id: string;
  asset_id: string;
  market_key: string;
  kind: 'market' | 'forecast';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

export type MarketInsight = {
  snapshots: MarketSnapshot[];
  run: AnalysisRun | null;
  forecast: AssetForecast | null;
};

export type AssetForecast = {
  id: string;
  asset_id: string;
  forecast_date: string;
  method: 'own_history' | 'comparable_retention' | 'unavailable';
  value_6m: number | null;
  low_6m: number | null;
  high_6m: number | null;
  value_12m: number | null;
  low_12m: number | null;
  high_12m: number | null;
  confidence: number;
  reason: string;
  evidence: {
    url: string;
    title: string;
    site_name: string;
    relevant: boolean;
  }[];
  created_at: string;
};

export type WishlistItem = {
  id: string;
  user_id: string;
  name: string;
  target_price: number;
  notes: string;
  price_source_url: string | null;
  price_checked_at: string | null;
  created_at: string;
};

export type ReplacementScenarioInput = {
  asset_id: string;
  wishlist_item_id: string;
  forecast_id: string;
  horizon_months: 6 | 12;
  target_price: number;
  current_asset_value: number;
  future_asset_value: number;
  change_now_cash: number;
  change_later_cash: number;
  waiting_cash_difference: number;
  assumptions: {
    target_price_constant: true;
    fees_included: false;
    source: 'user_wishlist';
  };
};
