import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSaleInput } from '../src/lib/purchase-input.ts';

test('sale input requires a valid date and positive price', () => {
  assert.deepEqual(parseSaleInput('', ''), {
    error: '请填写成交日期和成交价',
  });
  assert.deepEqual(parseSaleInput('9999-12-31', '100'), {
    error: '成交日期不能晚于今天',
  });
  assert.deepEqual(parseSaleInput('2026-07-24', '0'), {
    error: '成交价必须大于 0',
  });
  assert.deepEqual(parseSaleInput('2026-07-24', '88.50'), {
    input: { sold_at: '2026-07-24', sale_price: 88.5 },
  });
});
