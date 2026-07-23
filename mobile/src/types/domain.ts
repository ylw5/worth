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

export type AssetInput = {
  name: string;
  brand: string;
  model: string;
  specs: Record<string, string>;
  category: Category;
  condition: string;
  search_query: string;
};

export type Asset = AssetInput & {
  id: string;
  user_id: string;
  photo_paths: string[];
  photo_urls?: string[];
  latest_market_price: number | null;
  latest_valuation_at: string | null;
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
