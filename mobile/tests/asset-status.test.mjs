import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assetStatusLabels,
  assetStatuses,
  isCurrentAsset,
} from '../src/lib/asset-status.ts';

test('status labels cover the fixed lifecycle', () => {
  assert.deepEqual(assetStatuses, ['in_use', 'idle', 'listed', 'sold']);
  assert.equal(assetStatusLabels.sold, '已卖出');
  assert.equal(isCurrentAsset({ status: 'sold' }), false);
  assert.equal(isCurrentAsset({ status: 'listed' }), true);
});
