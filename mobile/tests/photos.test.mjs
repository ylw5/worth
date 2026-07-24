import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maxAssetPhotos,
  pickerAssetsToPhotos,
  setCover,
} from '../src/lib/photos.ts';

test('setCover moves one photo to the front without dropping order', () => {
  assert.equal(maxAssetPhotos, 5);
  const photos = ['a', 'b', 'c'].map((id) => ({ id, uri: id }));
  assert.deepEqual(
    setCover(photos, 2).map((photo) => photo.id),
    ['c', 'a', 'b'],
  );
  assert.equal(setCover(photos, 0), photos);
});

test('converts only readable picker assets up to the requested limit', () => {
  const assets = [
    { uri: 'first.jpg', base64: 'first' },
    { uri: 'missing.jpg', base64: null },
    { uri: 'third.jpg', base64: 'third' },
  ];

  assert.deepEqual(pickerAssetsToPhotos(assets, 2, 123), [
    {
      id: 'first.jpg-123-0',
      uri: 'first.jpg',
      base64: 'first',
    },
  ]);
});
