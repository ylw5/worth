import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatPurchaseDate,
  parsePurchaseInput,
} from '../src/lib/purchase-input.ts';

test('formats a local date without a timezone shift', () => {
  assert.equal(
    formatPurchaseDate(new Date(2026, 6, 24, 23, 30)),
    '2026-07-24',
  );
});

test('allows omitted purchase details', () => {
  assert.deepEqual(parsePurchaseInput('', ''), {
    input: { purchase_date: null, purchase_price: null },
  });
});

test('normalizes valid purchase details', () => {
  assert.deepEqual(parsePurchaseInput(' 2026-07-24 ', ' 3999.50 '), {
    input: { purchase_date: '2026-07-24', purchase_price: 3999.5 },
  });
});

test('rejects invalid calendar dates', () => {
  assert.deepEqual(parsePurchaseInput('2026-02-30', ''), {
    error: '买入日期必须是有效的 YYYY-MM-DD 日期',
  });
  assert.deepEqual(parsePurchaseInput('2026/07/24', ''), {
    error: '买入日期必须是有效的 YYYY-MM-DD 日期',
  });
});

test('rejects future purchase dates', () => {
  assert.deepEqual(parsePurchaseInput('9999-12-31', ''), {
    error: '买入日期不能晚于今天',
  });
});

test('rejects non-positive purchase prices', () => {
  assert.deepEqual(parsePurchaseInput('', '0'), {
    error: '买入价格必须大于 0',
  });
  assert.deepEqual(parsePurchaseInput('', '-1'), {
    error: '买入价格必须大于 0',
  });
});
