export type PurchaseInput = {
  purchase_date: string | null;
  purchase_price: number | null;
};

export function parsePurchaseInput(
  purchaseDate: string,
  purchasePrice: string,
): { input: PurchaseInput } | { error: string } {
  const date = purchaseDate.trim();
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date)
  ) {
    return { error: '买入日期必须是有效的 YYYY-MM-DD 日期' };
  }

  const priceText = purchasePrice.trim();
  const price = priceText ? Number(priceText) : null;
  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    return { error: '买入价格必须大于 0' };
  }

  return {
    input: {
      purchase_date: date || null,
      purchase_price: price,
    },
  };
}
