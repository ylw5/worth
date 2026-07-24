const DEFAULT_CARD_WIDTH_RATIO = 0.86;
const DEFAULT_GAP = 12;

export const getWishlistCarouselMetrics = (
  screenWidth: number,
  options?: { cardWidthRatio?: number; gap?: number },
) => {
  const cardWidthRatio = options?.cardWidthRatio ?? DEFAULT_CARD_WIDTH_RATIO;
  const gap = options?.gap ?? DEFAULT_GAP;
  const cardWidth = screenWidth * cardWidthRatio;
  const sidePadding = (screenWidth - cardWidth) / 2;
  return {
    cardWidth,
    gap,
    sidePadding,
    snapInterval: cardWidth + gap,
  };
};

export const getWishlistCarouselIndex = (
  offsetX: number,
  snapInterval: number,
  itemCount: number,
) => {
  if (itemCount <= 0 || snapInterval <= 0) return 0;
  const raw = Math.round(offsetX / snapInterval);
  return Math.min(Math.max(raw, 0), itemCount - 1);
};
