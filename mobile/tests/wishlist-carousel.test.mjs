import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWishlistCarouselIndex,
  getWishlistCarouselMetrics,
} from '../src/lib/wishlist-carousel.ts';

const assertApprox = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-9);
};

test('derives card width, side padding, and snap interval for peeking carousel', () => {
  const metrics = getWishlistCarouselMetrics(390, {
    cardWidthRatio: 0.78,
    gap: 12,
  });
  assertApprox(metrics.cardWidth, 304.2);
  assert.equal(metrics.gap, 12);
  assertApprox(metrics.sidePadding, 42.9);
  assertApprox(metrics.snapInterval, 316.2);
});

test('maps scroll offset to a clamped carousel index', () => {
  assert.equal(getWishlistCarouselIndex(0, 316.2, 3), 0);
  assert.equal(getWishlistCarouselIndex(316.2, 316.2, 3), 1);
  assert.equal(getWishlistCarouselIndex(632.4, 316.2, 3), 2);
  assert.equal(getWishlistCarouselIndex(1000, 316.2, 3), 2);
  assert.equal(getWishlistCarouselIndex(-10, 316.2, 3), 0);
  assert.equal(getWishlistCarouselIndex(0, 316.2, 0), 0);
});
