import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWishlistProgress,
  sumSavings,
} from '../src/lib/wishlist-progress.ts';

test('sums confirmed savings and derives capped wishlist progress', () => {
  assert.equal(sumSavings([]), 0);
  assert.equal(sumSavings([699, 237]), 936);
  assert.deepEqual(getWishlistProgress(936, 1280), {
    percentage: 73,
    barPercentage: 73,
  });
  assert.deepEqual(getWishlistProgress(1500, 1280), {
    percentage: 117,
    barPercentage: 100,
  });
});
