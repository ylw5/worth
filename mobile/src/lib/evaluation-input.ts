export function normalizeProductUrl(value: string):
  | { url: string }
  | { error: string } {
  const match = value.trim().match(/https?:\/\/[^\s]+/i);
  if (!match) return { error: '请输入有效的商品链接' };
  try {
    const candidate = match[0].replace(/[),.;!?\]}，。；！？）】》]+$/u, '');
    const url = new URL(candidate);
    if (!url.hostname) return { error: '请输入有效的商品链接' };
    return { url: url.toString() };
  } catch {
    return { error: '请输入有效的商品链接' };
  }
}

export function normalizeProductDescription(value: string):
  | { text: string }
  | { error: string } {
  const text = value.trim();
  if (text.length < 2) return { error: '请描述想购买的商品' };
  if (text.length > 4000) return { error: '商品描述不能超过 4000 字' };
  return { text };
}

export function normalizeOptionalPrice(value: string):
  | { price: number | null }
  | { error: string } {
  const normalized = value.trim().replace(/[￥¥,，\s]/gu, '');
  if (!normalized) return { price: null };
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: '请输入有效的商品价格' };
  }
  return { price: Math.round(price * 100) / 100 };
}
export function extractProductPrice(value: string): number | null {
  const match = value.match(
    /(?:[￥¥]\s*|价格(?:是|为|[:：])?\s*)(\d[\d,，]*(?:\.\d{1,2})?)/u,
  );
  if (!match) return null;
  const normalized = normalizeOptionalPrice(match[1]);
  return 'price' in normalized ? normalized.price : null;
}