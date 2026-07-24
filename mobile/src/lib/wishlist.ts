import { supabase } from '@/lib/supabase';
import type { WishlistInput } from '@/lib/wishlist-input';

export type WishlistItem = WishlistInput & {
  id: string;
  user_id: string;
  actual_price: number | null;
  fulfilled_at: string | null;
  created_at: string;
};

const normalizeWishlistItem = (item: WishlistItem): WishlistItem => ({
  ...item,
  target_price: Number(item.target_price),
  actual_price:
    item.actual_price === null ? null : Number(item.actual_price),
});

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listWishlistItems(): Promise<WishlistItem[]> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return ((data ?? []) as WishlistItem[]).map(normalizeWishlistItem);
}

export async function getWishlistItem(id: string): Promise<WishlistItem> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .eq('id', id)
    .single();
  fail(error);
  return normalizeWishlistItem(data as WishlistItem);
}

export async function createWishlistItem(
  userId: string,
  input: WishlistInput,
): Promise<WishlistItem> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .insert({ ...input, user_id: userId })
    .select('*')
    .single();
  fail(error);
  return normalizeWishlistItem(data as WishlistItem);
}

export async function deleteWishlistItem(id: string) {
  const { data, error } = await supabase
    .from('wishlist_items')
    .delete()
    .eq('id', id)
    .select('id');
  fail(error);
  if (!data?.length) throw new Error('已实现心愿请先撤销实现');
}
