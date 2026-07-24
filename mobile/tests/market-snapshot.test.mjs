import assert from 'node:assert/strict';
import {
  changeOverDays,
  jobCopy,
  percentChange,
} from '../src/lib/market-snapshot.ts';

assert.equal(jobCopy({ status: 'running' }), '行情更新中');
assert.equal(jobCopy({ status: 'failed' }), '本次更新失败，仍展示上次结果');
assert.equal(percentChange(120, 100), 20);
assert.equal(percentChange(100, null), null);
assert.equal(
  changeOverDays(
    [
      { snapshot_date: '2026-07-24', estimated_price: 120 },
      { snapshot_date: '2026-07-17', estimated_price: 100 },
    ],
    7,
  ),
  20,
);
console.log('market snapshot checks passed');
