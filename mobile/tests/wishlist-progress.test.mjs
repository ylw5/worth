import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWishlistProgress,
  sumAmounts,
} from '../src/lib/wishlist-progress.ts';

test('sums separate funding sources and derives combined wishlist progress', () => {
  const spendingTotal = sumAmounts([699, 237]);
  const salesTotal = sumAmounts([500, 120]);
  const fundedAmount = spendingTotal + salesTotal;

  assert.equal(sumAmounts([]), 0);
  assert.equal(spendingTotal, 936);
  assert.equal(salesTotal, 620);
  assert.equal(fundedAmount, 1556);
  assert.deepEqual(getWishlistProgress(fundedAmount, 2000), {
    percentage: 78,
    barPercentage: 78,
  });
  assert.deepEqual(getWishlistProgress(fundedAmount, 1280), {
    percentage: 122,
    barPercentage: 100,
  });
});
