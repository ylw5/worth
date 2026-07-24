import assert from 'node:assert/strict';
import test from 'node:test';

import { compareReplacement } from '../src/lib/replacement.ts';

test('compares current and delayed replacement cash', () => {
  assert.deepEqual(compareReplacement(5000, 1800, 1200), {
    changeNowCash: 3200,
    changeLaterCash: 3800,
    waitingCashDifference: 600,
  });
});

test('allows an asset to be worth more than the target', () => {
  assert.equal(compareReplacement(1000, 1200, 900).changeNowCash, -200);
});

test('withholds comparison when a value is absent', () => {
  assert.equal(compareReplacement(5000, 1800, null), null);
});
