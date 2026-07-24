import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAssetCoverUrl,
  mergeRecognition,
} from '../src/lib/incremental-import.ts';

const current = {
  name: '手动名称',
  brand: '',
  model: '',
  specs: { 颜色: '黑色' },
  category: '其他',
  condition: '无法判断',
  search_query: '',
  purchase_date: '2025-01-01',
  purchase_price: '100',
};

const incoming = {
  name: 'AI 名称',
  brand: '富士',
  model: 'X100VI',
  specs: { 颜色: '银色' },
  category: '数码',
  condition: '轻微使用痕迹',
  search_query: '富士 X100VI',
};

test('merges only fields the user has not protected', () => {
  const merged = mergeRecognition(
    current,
    incoming,
    new Set(['name', 'specs']),
  );
  assert.equal(merged.name, '手动名称');
  assert.equal(merged.brand, '富士');
  assert.deepEqual(merged.specs, { 颜色: '黑色' });
  assert.equal(merged.purchase_date, '2025-01-01');
});

test('selects the current cover cutout and falls back to original', () => {
  assert.equal(
    getAssetCoverUrl({
      photo_paths: ['a.jpg'],
      photo_urls: ['original'],
      photo_cutout_urls: { 'a.jpg': 'cutout' },
    }),
    'cutout',
  );
  assert.equal(
    getAssetCoverUrl({
      photo_paths: ['b.jpg'],
      photo_urls: ['original'],
      photo_cutout_urls: {},
    }),
    'original',
  );
});
