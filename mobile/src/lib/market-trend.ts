export type TrendRange = '30d' | '90d' | 'all';

type TrendRow = {
  snapshot_date: string;
  estimated_price: number;
};

export function jobCopy(run: { status: string } | null) {
  if (!run) return '等待后台更新';
  if (run.status === 'queued') return '已排队';
  if (run.status === 'running') return '行情更新中';
  if (run.status === 'failed') return '本次更新失败，仍展示上次结果';
  return '已更新';
}

export function filterTrend(rows: TrendRow[], range: TrendRange) {
  if (range === 'all' || rows.length === 0) return rows;
  const cutoff = new Date(`${rows.at(-1)!.snapshot_date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (range === '30d' ? 30 : 90));
  const date = cutoff.toISOString().slice(0, 10);
  return rows.filter((row) => row.snapshot_date >= date);
}

export function trendStats(rows: TrendRow[]) {
  if (rows.length === 0) return null;
  const first = rows[0].estimated_price;
  const last = rows.at(-1)!.estimated_price;
  const prices = rows.map((row) => row.estimated_price);
  return {
    change: last - first,
    percent:
      first === 0 ? null : Math.round(((last - first) / first) * 1000) / 10,
    high: Math.max(...prices),
    low: Math.min(...prices),
  };
}

export function plotTrend(rows: TrendRow[], width: number, height: number) {
  if (rows.length === 0 || width <= 0 || height <= 0) return [];
  if (rows.length === 1) return [{ x: 0, y: height / 2 }];
  const prices = rows.map((row) => row.estimated_price);
  const low = Math.min(...prices);
  const span = Math.max(...prices) - low || 1;
  return rows.map((row, index) => ({
    x: (index / (rows.length - 1)) * width,
    y: height - ((row.estimated_price - low) / span) * height,
  }));
}
