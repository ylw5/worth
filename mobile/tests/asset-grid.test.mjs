import assert from 'node:assert/strict';
import test from 'node:test';

import { getAssetGridColumns } from '../src/lib/asset-grid.ts';

test('chooses asset grid columns from the viewport width', () => {
  assert.equal(getAssetGridColumns(699), 2);
  assert.equal(getAssetGridColumns(700), 3);
  assert.equal(getAssetGridColumns(999), 3);
  assert.equal(getAssetGridColumns(1000), 4);
});
