import crypto from 'node:crypto';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
]);

/**
 * Normalizes a URL:
 * - Removes hash fragment
 * - Strips common tracking query parameters
 * - Lowercases hostname
 * - Sorts query params alphabetically
 * - Removes trailing slash if path is not root
 */
export function normalizeUrl(urlString: string, baseUrl?: string): string {
  try {
    const url = baseUrl ? new URL(urlString, baseUrl) : new URL(urlString);

    // Remove hash
    url.hash = '';

    // Remove tracking params
    const keysToDelete: string[] = [];
    url.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }

    // Sort remaining params
    url.searchParams.sort();

    // Clean pathname
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    url.pathname = pathname;

    return url.toString();
  } catch {
    return urlString;
  }
}

/**
 * Generates a consistent SHA-256 hash from a normalized URL.
 * Used for database uniqueness and idempotent deduplication.
 */
export function hashUrl(urlString: string): string {
  const normalized = normalizeUrl(urlString);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extracts normalized domain from a URL.
 */
export function extractDomain(urlString: string): string {
  try {
    const url = new URL(urlString);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Checks if target link belongs to the same domain (internal link)
 */
export function isInternalLink(linkUrl: string, baseDomain: string): boolean {
  try {
    const parsed = new URL(linkUrl);
    const linkDomain = parsed.hostname.toLowerCase();
    const cleanBase = baseDomain.toLowerCase().replace(/^www\./, '');
    const cleanLink = linkDomain.replace(/^www\./, '');

    return cleanLink === cleanBase || cleanLink.endsWith(`.${cleanBase}`);
  } catch {
    return false;
  }
}
