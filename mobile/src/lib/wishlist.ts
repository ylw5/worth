import { supabase } from '@/lib/supabase';
import type { WishlistInput } from '@/lib/wishlist-input';
import type { WishlistItem } from '@/types/domain';

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listWishlistItems(): Promise<WishlistItem[]> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return (data ?? []) as WishlistItem[];
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
  return data as WishlistItem;
}

export async function deleteWishlistItem(id: string) {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id);
  fail(error);
}
