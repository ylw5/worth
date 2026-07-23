import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWishlistInput } from '../src/lib/wishlist-input.ts';

test('validates and normalizes wishlist input', () => {
  assert.deepEqual(parseWishlistInput('', '100', ''), {
    error: '请填写名称',
  });
  assert.deepEqual(parseWishlistInput('相机', '0', ''), {
    error: '目标价格必须大于 0',
  });
  assert.deepEqual(parseWishlistInput(' 相机 ', '3999', ' 旅行用 '), {
    input: { name: '相机', target_price: 3999, notes: '旅行用' },
  });
});
