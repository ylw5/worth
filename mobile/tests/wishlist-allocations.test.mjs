import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAllocationPreview,
  getAllocatedAmount,
  getAvailableAmount,
  parseFulfillmentPrice,
} from '../src/lib/wishlist-allocations.ts';

const allocations = [
  {
    spending_resolution_id: 'skip-1',
    asset_sale_id: null,
    amount: 300,
  },
  {
    spending_resolution_id: null,
    asset_sale_id: 'sale-1',
    amount: 1200,
  },
  {
    spending_resolution_id: 'skip-1',
    asset_sale_id: null,
    amount: 200,
  },
];

test('derives remaining source balances from prior allocations', () => {
  assert.equal(
    getAllocatedAmount(allocations, 'spending_resolution', 'skip-1'),
    500,
  );
  assert.equal(
    getAllocatedAmount(allocations, 'asset_sale', 'sale-1'),
    1200,
  );
  assert.equal(getAvailableAmount(800, 500), 300);
  assert.equal(getAvailableAmount(800, 900), 0);
});

test('allocates in selection order and partially uses only the last source', () => {
  assert.deepEqual(
    buildAllocationPreview(6000, [
      {
        source_type: 'spending_resolution',
        source_id: 'skip-1',
        available_amount: 800,
      },
      {
        source_type: 'asset_sale',
        source_id: 'sale-1',
        available_amount: 5000,
      },
      {
        source_type: 'asset_sale',
        source_id: 'sale-2',
        available_amount: 1000,
      },
    ]),
    {
      allocations: [
        {
          source_type: 'spending_resolution',
          source_id: 'skip-1',
          amount: 800,
        },
        {
          source_type: 'asset_sale',
          source_id: 'sale-1',
          amount: 5000,
        },
        {
          source_type: 'asset_sale',
          source_id: 'sale-2',
          amount: 200,
        },
      ],
      funded_amount: 6000,
      self_paid_amount: 0,
    },
  );
});

test('supports insufficient and empty funding without floating-point drift', () => {
  assert.deepEqual(
    buildAllocationPreview(0.3, [
      {
        source_type: 'spending_resolution',
        source_id: 'skip-1',
        available_amount: 0.1,
      },
      {
        source_type: 'asset_sale',
        source_id: 'sale-1',
        available_amount: 0.2,
      },
    ]),
    {
      allocations: [
        {
          source_type: 'spending_resolution',
          source_id: 'skip-1',
          amount: 0.1,
        },
        {
          source_type: 'asset_sale',
          source_id: 'sale-1',
          amount: 0.2,
        },
      ],
      funded_amount: 0.3,
      self_paid_amount: 0,
    },
  );
  assert.deepEqual(buildAllocationPreview(1000, []), {
    allocations: [],
    funded_amount: 0,
    self_paid_amount: 1000,
  });
});

test('validates the actual fulfillment price', () => {
  assert.deepEqual(parseFulfillmentPrice(''), {
    error: '请填写实际成交价',
  });
  assert.deepEqual(parseFulfillmentPrice('0'), {
    error: '实际成交价必须大于 0',
  });
  assert.deepEqual(parseFulfillmentPrice(' 3999.50 '), {
    price: 3999.5,
  });
});
