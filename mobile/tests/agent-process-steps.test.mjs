import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completedToolsFromProcessSteps,
  processSummaryLabel,
  visibleLiveProcessSteps,
} from '../src/lib/agent-process-steps.ts';

test('visibleLiveProcessSteps drops replying and thinking after tools start', () => {
  assert.deepEqual(
    visibleLiveProcessSteps([
      { kind: 'status', status: 'thinking' },
      { kind: 'status', status: 'replying' },
    ]),
    [{ kind: 'status', status: 'thinking' }],
  );

  assert.deepEqual(
    visibleLiveProcessSteps([
      { kind: 'status', status: 'thinking' },
      {
        kind: 'tool',
        id: 't0',
        name: 'recognize_product_text',
        label: '识别商品',
        phase: 'started',
      },
      { kind: 'status', status: 'thinking' },
      { kind: 'status', status: 'replying' },
    ]),
    [
      {
        kind: 'tool',
        id: 't0',
        name: 'recognize_product_text',
        label: '识别商品',
        phase: 'started',
      },
    ],
  );
});

test('completedToolsFromProcessSteps keeps tool order and drops status', () => {
  assert.deepEqual(completedToolsFromProcessSteps([]), []);
  assert.deepEqual(
    completedToolsFromProcessSteps([
      { kind: 'status', status: 'thinking' },
      {
        kind: 'tool',
        id: 't0',
        name: 'recognize_product_text',
        label: '识别商品',
        phase: 'completed',
      },
      {
        kind: 'tool',
        id: 't1',
        name: 'assets_summary',
        label: '查看资产',
        phase: 'started',
      },
      { kind: 'status', status: 'replying' },
    ]),
    [
      { name: 'recognize_product_text', label: '识别商品' },
      { name: 'assets_summary', label: '查看资产' },
    ],
  );
});

test('processSummaryLabel formats count', () => {
  assert.equal(processSummaryLabel(1), '已调用 1 个步骤');
  assert.equal(processSummaryLabel(3), '已调用 3 个步骤');
});
