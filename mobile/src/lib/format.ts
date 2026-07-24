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

export const formatDateOnly = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`));

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
