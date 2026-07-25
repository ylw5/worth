import assert from 'node:assert/strict';
import test from 'node:test';

import {
  outboundUserContent,
  shouldShowPendingUserMessage,
} from '../src/lib/pending-user-message.ts';

test('outboundUserContent trims text and falls back for empty', () => {
  assert.equal(outboundUserContent('  你好  '), '你好');
  assert.equal(outboundUserContent(''), '看看这件商品');
  assert.equal(outboundUserContent('   '), '看看这件商品');
});

test('shouldShowPendingUserMessage hides when null or already on server', () => {
  assert.equal(shouldShowPendingUserMessage(null, []), false);
  assert.equal(shouldShowPendingUserMessage('你好', []), true);
  assert.equal(
    shouldShowPendingUserMessage('你好', [
      { role: 'assistant', content: '之前' },
      { role: 'user', content: '你好' },
    ]),
    false,
  );
  assert.equal(
    shouldShowPendingUserMessage('你好', [
      { role: 'user', content: '别的' },
    ]),
    true,
  );
  assert.equal(
    shouldShowPendingUserMessage('你好', [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '嗯' },
    ]),
    true,
  );
});
