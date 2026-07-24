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
  photo_paths: string[];
  photo_urls?: string[];
  photo_cutout_paths: Record<string, string>;
  photo_cutout_urls?: Record<string, string>;
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
