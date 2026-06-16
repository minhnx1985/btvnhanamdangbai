export {};

const NHANAM_HOSTS = new Set(["nhanam.vn", "www.nhanam.vn"]);

function findFirstUrl(text: string): URL | null {
  const matches = text.match(/https?:\/\/[^\s]+/g) ?? [];

  for (const match of matches) {
    try {
      const url = new URL(match);
      if (NHANAM_HOSTS.has(url.hostname.toLowerCase())) {
        return url;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function extractNhanamProductAlias(text: string): string | null {
  const url = findFirstUrl(text);
  if (!url) {
    return null;
  }

  const alias = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)[0];

  return alias || null;
}

export function isNhanamProductUrl(text: string): boolean {
  return extractNhanamProductAlias(text) !== null;
}
