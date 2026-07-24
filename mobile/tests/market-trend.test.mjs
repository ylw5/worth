import assert from 'node:assert/strict';

import {
  filterTrend,
  jobCopy,
  plotTrend,
  trendStats,
} from '../src/lib/market-trend.ts';

const snapshots = [
  { snapshot_date: '2026-04-01', estimated_price: 80 },
  { snapshot_date: '2026-07-01', estimated_price: 100 },
  { snapshot_date: '2026-07-20', estimated_price: 90 },
  { snapshot_date: '2026-07-25', estimated_price: 120 },
];

assert.deepEqual(
  filterTrend(snapshots, '30d').map((row) => row.estimated_price),
  [100, 90, 120],
);
assert.deepEqual(trendStats(snapshots.slice(1)), {
  change: 20,
  percent: 20,
  high: 120,
  low: 90,
});
assert.deepEqual(plotTrend([snapshots[3]], 280, 120), [
  { x: 0, y: 60 },
]);
assert.deepEqual(plotTrend([], 280, 120), []);
assert.equal(jobCopy({ status: 'running' }), '行情更新中');
assert.equal(
  jobCopy({ status: 'failed' }),
  '本次更新失败，仍展示上次结果',
);
