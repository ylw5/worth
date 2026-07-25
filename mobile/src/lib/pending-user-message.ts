export function outboundUserContent(text: string): string {
  const trimmed = text.trim();
  return trimmed || '看看这件商品';
}

export function shouldShowPendingUserMessage(
  pending: string | null,
  messages: ReadonlyArray<{ role: string; content: string }>,
): boolean {
  if (!pending) return false;
  const last = messages[messages.length - 1];
  if (last?.role === 'user' && last.content === pending) return false;
  return true;
}
