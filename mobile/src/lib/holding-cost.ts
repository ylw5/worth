const DAY_MS = 86_400_000;

function utcDay(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) throw new Error('无效日期');
  return date;
}

export function holdingCost({
  purchasePrice,
  currentValue,
  purchaseDate,
  now = new Date(),
}: {
  purchasePrice: number | null;
  currentValue: number | null;
  purchaseDate: string | null;
  now?: Date;
}) {
  if (purchasePrice == null || currentValue == null || !purchaseDate) {
    return null;
  }
  const ownedDays = Math.max(
    1,
    Math.floor(
      (utcDay(now.toISOString()).getTime() - utcDay(purchaseDate).getTime()) /
        DAY_MS,
    ),
  );
  const totalLoss = purchasePrice - currentValue;
  return {
    ownedDays,
    totalLoss,
    dailyLoss: Math.round((totalLoss / ownedDays) * 100) / 100,
    annualizedLoss:
      Math.round((totalLoss / ownedDays) * 365.25 * 100) / 100,
  };
}

export function historicalPoints(
  purchasePrice: number | null,
  purchaseDate: string | null,
  snapshots: { snapshot_date: string; estimated_price: number }[],
): { date: string; value: number; kind: 'purchase' | 'market' }[] {
  if (purchasePrice == null || !purchaseDate) return [];
  return [
    { date: purchaseDate, value: purchasePrice, kind: 'purchase' },
    ...snapshots
      .map(({ snapshot_date, estimated_price }) => ({
        date: snapshot_date,
        value: estimated_price,
        kind: 'market' as const,
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  ];
}
