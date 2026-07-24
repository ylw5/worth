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
    cardWidthRatio: 0.86,
    gap: 12,
  });
  assertApprox(metrics.cardWidth, 335.4);
  assert.equal(metrics.gap, 12);
  assertApprox(metrics.sidePadding, 27.3);
  assertApprox(metrics.snapInterval, 347.4);
});

test('maps scroll offset to a clamped carousel index', () => {
  assert.equal(getWishlistCarouselIndex(0, 347.4, 3), 0);
  assert.equal(getWishlistCarouselIndex(347.4, 347.4, 3), 1);
  assert.equal(getWishlistCarouselIndex(694.8, 347.4, 3), 2);
  assert.equal(getWishlistCarouselIndex(1000, 347.4, 3), 2);
  assert.equal(getWishlistCarouselIndex(-10, 347.4, 3), 0);
  assert.equal(getWishlistCarouselIndex(0, 347.4, 0), 0);
});
