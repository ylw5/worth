export function jobCopy(run: { status: string } | null) {
  if (!run) return '等待后台更新';
  if (run.status === 'queued') return '已排队';
  if (run.status === 'running') return '行情更新中';
  if (run.status === 'failed') return '本次更新失败，仍展示上次结果';
  return '已更新';
}

export function percentChange(
  current: number | null,
  previous: number | null,
) {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function changeOverDays(
  snapshots: { snapshot_date: string; estimated_price: number }[],
  days: number,
) {
  const latest = snapshots[0];
  if (!latest) return null;
  const target = new Date(`${latest.snapshot_date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - days);
  const baseline = snapshots.find(
    (row) => row.snapshot_date <= target.toISOString().slice(0, 10),
  );
  return percentChange(
    latest.estimated_price,
    baseline?.estimated_price ?? null,
  );
}
