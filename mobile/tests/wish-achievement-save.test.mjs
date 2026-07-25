import assert from 'node:assert/strict';
import test from 'node:test';

import { wishAchievementSaveErrorMessage } from '../src/lib/wish-achievement-save-messages.ts';

test('maps permission and unknown save errors', () => {
  assert.equal(
    wishAchievementSaveErrorMessage(new Error('Missing permission')),
    '需要相册权限才能保存，请在设置中开启',
  );
  assert.equal(
    wishAchievementSaveErrorMessage(new Error('disk full')),
    'disk full',
  );
  assert.equal(wishAchievementSaveErrorMessage(null), '保存失败，请重试');
});
