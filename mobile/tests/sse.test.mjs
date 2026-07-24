import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSseEvent, splitSseBuffer } from '../src/lib/sse.ts';

test('splits complete SSE events and keeps the incomplete tail', () => {
  const { events, rest } = splitSseBuffer(
    'data: {"delta":"你"}\n\ndata: {"delta":"好"}\n\ndata: {"del',
  );
  assert.deepEqual(events, ['data: {"delta":"你"}', 'data: {"delta":"好"}']);
  assert.equal(rest, 'data: {"del');
});

test('parses delta, error and done events', () => {
  assert.deepEqual(parseSseEvent('data: {"delta":"先看看"}'), {
    type: 'delta',
    text: '先看看',
  });
  assert.deepEqual(parseSseEvent('data: {"error":"暂时不可用"}'), {
    type: 'error',
    message: '暂时不可用',
  });
  assert.deepEqual(parseSseEvent('data: [DONE]'), { type: 'done' });
});

test('ignores malformed or empty events', () => {
  assert.equal(parseSseEvent(': keep-alive'), null);
  assert.equal(parseSseEvent('data: not-json'), null);
  assert.equal(parseSseEvent(''), null);
});
