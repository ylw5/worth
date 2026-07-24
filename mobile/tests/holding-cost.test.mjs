import assert from 'node:assert/strict';
import { holdingCost, historicalPoints } from '../src/lib/holding-cost.ts';

const result = holdingCost({
  purchasePrice: 2000,
  currentValue: 1180,
  purchaseDate: '2026-01-01',
  now: new Date('2026-07-20T00:00:00Z'),
});
assert.deepEqual(result, {
  ownedDays: 200,
  totalLoss: 820,
  dailyLoss: 4.1,
  annualizedLoss: 1497.53,
});

assert.equal(
  holdingCost({
    purchasePrice: 1000,
    currentValue: 1200,
    purchaseDate: '2026-07-20',
    now: new Date('2026-07-20T12:00:00Z'),
  }).dailyLoss,
  -200,
);

assert.deepEqual(
  historicalPoints(2000, '2026-01-01', [
    { snapshot_date: '2026-07-20', estimated_price: 1180 },
    { snapshot_date: '2026-07-19', estimated_price: 1200 },
  ]),
  [
    { date: '2026-01-01', value: 2000, kind: 'purchase' },
    { date: '2026-07-19', value: 1200, kind: 'market' },
    { date: '2026-07-20', value: 1180, kind: 'market' },
  ],
);
console.log('holding cost checks passed');
