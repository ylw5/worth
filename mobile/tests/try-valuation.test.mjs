import assert from 'node:assert/strict';
import test from 'node:test';

import { tryValuation } from '../src/lib/try-valuation.ts';

test('valuation failure stays non-fatal', async () => {
  assert.equal(await tryValuation(async () => {}), true);
  assert.equal(
    await tryValuation(async () => {
      throw new Error('offline');
    }),
    false,
  );
});
