export const formatCurrency = (value: number | null) =>
  value === null
    ? '待估价'
    : new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        maximumFractionDigits: 0,
      }).format(value);

export const formatDate = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));

export const formatOwnershipDuration = (purchaseDate: string | null) => {
  if (!purchaseDate) return null;
  const start = new Date(`${purchaseDate}T00:00:00`);
  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) return '不足 1 个月';
  if (months < 12) return `已使用 ${months} 个月`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return `已使用 ${years} 年`;
  return `已使用 ${years} 年 ${remainingMonths} 个月`;
};

export const formatOwnershipMeta = (
  purchasePrice: number | null,
  purchaseDate: string | null,
) => {
  const parts: string[] = [];
  if (purchasePrice !== null) {
    parts.push(formatCurrency(purchasePrice));
  }
  const duration = formatOwnershipDuration(purchaseDate);
  if (duration) parts.push(duration);
  return parts.length ? parts.join(' · ') : null;
};

export const specsToText = (specs: Record<string, string>) =>
  Object.entries(specs)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

export const textToSpecs = (value: string) =>
  Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.split(':', 2).map((part) => part.trim()))
      .filter(([key, item]) => key && item),
  );
