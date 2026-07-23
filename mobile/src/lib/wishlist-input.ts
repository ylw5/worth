export type WishlistInput = {
  name: string;
  target_price: number;
  notes: string;
};

export function parseWishlistInput(
  name: string,
  targetPrice: string,
  notes: string,
): { input: WishlistInput } | { error: string } {
  if (!name.trim()) return { error: '请填写名称' };
  const price = Number(targetPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: '目标价格必须大于 0' };
  }
  return {
    input: {
      name: name.trim(),
      target_price: price,
      notes: notes.trim(),
    },
  };
}
