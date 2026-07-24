export type FundingSourceType = 'spending_resolution' | 'asset_sale';

export type FundingAllocationInput = {
  source_type: FundingSourceType;
  source_id: string;
  amount: number;
};

export type SelectableFundingSource = Omit<
  FundingAllocationInput,
  'amount'
> & {
  available_amount: number;
};

export type FundingAllocationRecord = {
  spending_resolution_id: string | null;
  asset_sale_id: string | null;
  amount: number;
};

export type AllocationPreview = {
  allocations: FundingAllocationInput[];
  funded_amount: number;
  self_paid_amount: number;
};

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (amount: number) => amount / 100;

export function getAllocatedAmount(
  allocations: FundingAllocationRecord[],
  sourceType: FundingSourceType,
  sourceId: string,
) {
  const sourceField =
    sourceType === 'spending_resolution'
      ? 'spending_resolution_id'
      : 'asset_sale_id';
  return fromCents(
    allocations.reduce(
      (total, allocation) =>
        allocation[sourceField] === sourceId
          ? total + toCents(allocation.amount)
          : total,
      0,
    ),
  );
}

export function getAvailableAmount(
  originalAmount: number,
  allocatedAmount: number,
) {
  return fromCents(
    Math.max(toCents(originalAmount) - toCents(allocatedAmount), 0),
  );
}

export function buildAllocationPreview(
  actualPrice: number,
  selectedSources: SelectableFundingSource[],
): AllocationPreview {
  let remaining = Math.max(toCents(actualPrice), 0);
  const allocations: FundingAllocationInput[] = [];

  for (const source of selectedSources) {
    if (!remaining) break;
    const used = Math.min(
      Math.max(toCents(source.available_amount), 0),
      remaining,
    );
    if (!used) continue;
    allocations.push({
      source_type: source.source_type,
      source_id: source.source_id,
      amount: fromCents(used),
    });
    remaining -= used;
  }

  const actual = Math.max(toCents(actualPrice), 0);
  return {
    allocations,
    funded_amount: fromCents(actual - remaining),
    self_paid_amount: fromCents(remaining),
  };
}

export function parseFulfillmentPrice(
  value: string,
): { price: number } | { error: string } {
  const normalizedValue = value.trim();
  if (!normalizedValue) return { error: '请填写实际成交价' };
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalizedValue)) {
    return { error: '请输入普通十进制金额，最多保留两位小数' };
  }
  const price = Number(normalizedValue);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: '实际成交价必须大于 0' };
  }
  return { price: fromCents(toCents(price)) };
}
