function normalizeExplicitUrl(value?: string) {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || undefined;
}

function apiUrlFromDevelopmentHost(value?: string) {
  if (!value?.trim()) return undefined;
  try {
    const candidate = value.includes('://') ? value : `http://${value}`;
    const hostname = new URL(candidate).hostname;
    if (!hostname) return undefined;
    return `http://${hostname}:8000`;
  } catch {
    return undefined;
  }
}

export function resolveApiUrl({
  explicitUrl,
  developmentHosts = [],
  webHostname,
}: {
  explicitUrl?: string;
  developmentHosts?: (string | null | undefined)[];
  webHostname?: string;
}) {
  const explicit = normalizeExplicitUrl(explicitUrl);
  if (explicit) return explicit;

  for (const host of developmentHosts) {
    const inferred = apiUrlFromDevelopmentHost(host ?? undefined);
    if (inferred) return inferred;
  }

  return apiUrlFromDevelopmentHost(webHostname);
}
