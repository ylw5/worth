import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractProductPrice,
  normalizeOptionalPrice,
  normalizeProductDescription,
  normalizeProductUrl,
} from '../src/lib/evaluation-input.ts';

test('extracts and normalizes a product URL', () => {
  assert.deepEqual(normalizeProductUrl('复制内容 https://shop.example/p/1。）'), {
    url: 'https://shop.example/p/1',
  });
});

test('rejects text without an HTTP product URL', () => {
  assert.deepEqual(normalizeProductUrl('shop.example/p/1'), {
    error: '请输入有效的商品链接',
  });
});

test('normalizes a direct product description and optional price', () => {
  assert.deepEqual(normalizeProductDescription('  索尼降噪耳机  '), {
    text: '索尼降噪耳机',
  });
  assert.deepEqual(normalizeOptionalPrice('￥ 2,999.50'), {
    price: 2999.5,
  });
  assert.deepEqual(normalizeOptionalPrice(''), { price: null });
});

test('rejects an invalid optional price', () => {
  assert.deepEqual(normalizeOptionalPrice('-12'), {
    error: '请输入有效的商品价格',
  });
});
test('extracts an explicitly written price from the chatbox text', () => {
  assert.equal(extractProductPrice('索尼降噪耳机，价格 2,999 元'), 2999);
  assert.equal(extractProductPrice('想看看 ￥1899.50 的这款相机'), 1899.5);
  assert.equal(extractProductPrice('iPhone 17 256GB'), null);
});