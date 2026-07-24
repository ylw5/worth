import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectSellPlanReadiness,
  isSellPlanSnapshotCurrent,
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

test('distinguishes in-use valued assets from confirmed sell candidates', () => {
  const readiness = inspectSellPlanReadiness([
    {
      id: 'used',
      name: '仍在使用的耳机',
      status: 'in_use',
      latest_market_price: 1000,
      latest_market_price_low: 800,
      latest_market_price_high: 1200,
      latest_valuation_at: '2026-07-25T02:00:00.000Z',
      updated_at: '2026-07-24T16:00:00.000Z',
    },
    {
      id: 'idle',
      name: '尚未估价的闲置相机',
      status: 'idle',
      latest_market_price: null,
      latest_market_price_low: null,
      latest_market_price_high: null,
      latest_valuation_at: null,
      updated_at: '2026-07-25T03:00:00.000Z',
    },
  ]);

  assert.equal(readiness.eligible.length, 1);
  assert.equal(readiness.needsValuation[0].id, 'idle');
  assert.equal(readiness.inUseValued[0].id, 'used');
  assert.equal(readiness.valuedEligible.length, 0);
});

test('invalidates a daily snapshot when asset state or valuation is newer', () => {
  const snapshot = {
    target_price: 2000,
    updated_at: '2026-07-25T02:00:00.000Z',
  };
  const asset = {
    updated_at: '2026-07-25T03:00:00.000Z',
    latest_valuation_at: null,
  };

  assert.equal(
    isSellPlanSnapshotCurrent(snapshot, 2000, [asset]),
    false,
  );
  assert.equal(
    isSellPlanSnapshotCurrent(
      { ...snapshot, updated_at: '2026-07-25T04:00:00.000Z' },
      2000,
      [asset],
    ),
    true,
  );
});
