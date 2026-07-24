import assert from 'node:assert/strict';
import test from 'node:test';

import { conditions } from '../src/types/domain.ts';

test('condition options stay fixed and ordered', () => {
  assert.deepEqual(conditions, [
    '全新未使用',
    '几乎全新',
    '轻微使用痕迹',
    '明显使用痕迹',
    '重度使用或有瑕疵',
    '无法判断',
  ]);
});
