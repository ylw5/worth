import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseEvaluationReply,
  stripEvaluationMarks,
} from '../src/lib/spending-resolution-markers.ts';

test('extracts a skip decision and positive amount', () => {
  assert.deepEqual(
    parseEvaluationReply(
      '这次更像重复消费。\n[decision:skip]\n[spending_resolution:699.00]',
    ),
    {
      decision: 'skip',
      resolutionAmount: 699,
      cleaned: '这次更像重复消费。',
    },
  );
});

test('does not create a resolution without a valid price', () => {
  for (const marker of [
    '[spending_resolution:]',
    '[spending_resolution:-1]',
    '[spending_resolution:1.999]',
    '[spending_resolution:abc]',
  ]) {
    assert.equal(
      parseEvaluationReply(`[decision:skip]\n${marker}`).resolutionAmount,
      null,
    );
  }
});

test('keeps buy and undecided replies free of a resolution', () => {
  assert.deepEqual(parseEvaluationReply('可以买。\n[decision:buy]'), {
    decision: 'buy',
    resolutionAmount: null,
    cleaned: '可以买。',
  });
  assert.deepEqual(parseEvaluationReply('你每周会用几次？'), {
    decision: null,
    resolutionAmount: null,
    cleaned: '你每周会用几次？',
  });
});

test('strips both hidden markers from display text', () => {
  assert.equal(
    stripEvaluationMarks(
      '先不买。 [decision:skip] [spending_resolution:699.00]',
    ),
    '先不买。',
  );
});
