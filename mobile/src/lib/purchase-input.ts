export function formatPurchaseDate(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

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
  if (date && date > formatPurchaseDate(new Date())) {
    return { error: '买入日期不能晚于今天' };
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

export function parseSaleInput(
  soldAt: string,
  salePrice: string,
):
  | { input: { sold_at: string; sale_price: number } }
  | { error: string } {
  if (!soldAt.trim() || !salePrice.trim()) {
    return { error: '请填写成交日期和成交价' } as const;
  }

  const parsed = parsePurchaseInput(soldAt, salePrice);
  if ('error' in parsed) {
    return {
      error: parsed.error
        .replace('买入日期', '成交日期')
        .replace('买入价格', '成交价'),
    } as const;
  }

  return {
    input: {
      sold_at: parsed.input.purchase_date as string,
      sale_price: parsed.input.purchase_price as number,
    },
  } as const;
}
