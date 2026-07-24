import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assetStatusLabels,
  assetStatuses,
  isCurrentAsset,
  matchesAssetFilters,
} from '../src/lib/asset-status.ts';

test('status labels cover the fixed lifecycle', () => {
  assert.deepEqual(assetStatuses, ['in_use', 'idle', 'listed', 'sold']);
  assert.equal(assetStatusLabels.sold, '已卖出');
  assert.equal(isCurrentAsset({ status: 'sold' }), false);
  assert.equal(isCurrentAsset({ status: 'listed' }), true);
});

test('status and category filters apply together', () => {
  const asset = { status: 'idle', category: '数码' };

  assert.equal(matchesAssetFilters(asset, null, null), true);
  assert.equal(matchesAssetFilters(asset, 'idle', null), true);
  assert.equal(matchesAssetFilters(asset, 'listed', null), false);
  assert.equal(matchesAssetFilters(asset, null, '数码'), true);
  assert.equal(matchesAssetFilters(asset, null, '家电'), false);
  assert.equal(matchesAssetFilters(asset, 'idle', '数码'), true);
  assert.equal(matchesAssetFilters(asset, 'idle', '家电'), false);
});
