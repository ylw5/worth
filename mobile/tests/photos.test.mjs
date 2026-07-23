import assert from 'node:assert/strict';
import test from 'node:test';

import { maxAssetPhotos, setCover } from '../src/lib/photos.ts';

test('setCover moves one photo to the front without dropping order', () => {
  assert.equal(maxAssetPhotos, 5);
  const photos = ['a', 'b', 'c'].map((id) => ({ id, uri: id }));
  assert.deepEqual(
    setCover(photos, 2).map((photo) => photo.id),
    ['c', 'a', 'b'],
  );
  assert.equal(setCover(photos, 0), photos);
});
