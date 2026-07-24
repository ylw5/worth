import type { FundingAllocationInput } from '@/lib/wishlist-allocations';
import { supabase } from '@/lib/supabase';

export type WishlistFundingAllocation = {
  id: string;
  user_id: string;
  wishlist_item_id: string;
  spending_resolution_id: string | null;
  asset_sale_id: string | null;
  amount: number;
  created_at: string;
};

function fail(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes('funding balance changed')) {
    throw new Error('资金余额已变化，请重新确认');
  }
  if (error.message.includes('sale is allocated')) {
    throw new Error('这笔成交款已用于心愿，请先撤销对应心愿');
  }
  throw new Error(error.message);
}

export async function listWishlistFundingAllocations(): Promise<
  WishlistFundingAllocation[]
> {
  const { data, error } = await supabase
    .from('wishlist_funding_allocations')
    .select('*')
    .order('created_at', { ascending: false });
  fail(error);
  return ((data ?? []) as WishlistFundingAllocation[]).map((allocation) => ({
    ...allocation,
    amount: Number(allocation.amount),
  }));
}

export async function fulfillWishlistItem(
  wishlistItemId: string,
  actualPrice: number,
  allocations: FundingAllocationInput[],
) {
  const { error } = await supabase.rpc('fulfill_wishlist_item', {
    p_wishlist_item_id: wishlistItemId,
    p_actual_price: actualPrice,
    p_allocations: allocations,
  });
  fail(error);
}

export async function unfulfillWishlistItem(wishlistItemId: string) {
  const { error } = await supabase.rpc('unfulfill_wishlist_item', {
    p_wishlist_item_id: wishlistItemId,
  });
  fail(error);
}
