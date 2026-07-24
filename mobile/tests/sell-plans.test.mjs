import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localDateKey,
  toSellPlanAssets,
} from '../src/lib/sell-plan-helpers.ts';

test('uses local calendar date', () => {
  assert.equal(localDateKey(new Date(2026, 6, 24, 23, 30)), '2026-07-24');
});

test('only includes valued idle or listed assets', () => {
  const base = {
    brand: '',
    model: '',
    specs: {},
    category: '数码',
    subcategory: '手机',
    condition: '',
    search_query: 'phone',
    latest_market_price_low: 800,
    latest_market_price_high: 1200,
    latest_valuation_at: null,
  };
  assert.deepEqual(
    toSellPlanAssets([
      {
        ...base,
        id: 'idle',
        name: '闲置手机',
        status: 'idle',
        latest_market_price: 1000,
      },
      {
        ...base,
        id: 'used',
        name: '在用手机',
        status: 'in_use',
        latest_market_price: 1000,
      },
    ]),
    [
      {
        id: 'idle',
        name: '闲置手机',
        status: 'idle',
        estimated_price: 1000,
        price_low: 800,
        latest_valuation_at: null,
      },
    ],
  );
});
