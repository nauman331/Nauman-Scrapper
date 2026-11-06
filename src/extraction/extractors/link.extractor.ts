import type { CheerioAPI } from 'cheerio';
import type { ExtractedLink } from '../schemas/extraction.schema.js';
import { normalizeUrl, isInternalLink, extractDomain } from '../../core/domain/url-normalizer.js';

export interface LinkExtractionResult {
  links: ExtractedLink[];
  discoveredUrls: string[];
}

export function extractLinks(
  $: CheerioAPI,
  currentUrl: string,
  options: {
    maxLinks?: number;
    filterInternalOnly?: boolean;
    discoverLinks?: boolean;
    specificPageKeywords?: string[];
  } = {}
): LinkExtractionResult {
  const max = options.maxLinks ?? 100;
  const filterInternalOnly = options.filterInternalOnly ?? false;
  const currentDomain = extractDomain(currentUrl);

  const seenUrls = new Set<string>();
  const links: ExtractedLink[] = [];
  const discoveredUrls: string[] = [];

  for (const el of $('a[href]').toArray()) {
    if (links.length >= max) {
      break;
    }

    const href = $(el).attr('href')?.trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }

    let absoluteUrl: string;
    try {
      absoluteUrl = normalizeUrl(href, currentUrl);
    } catch {
      continue;
    }

    if (seenUrls.has(absoluteUrl)) {
      continue;
    }
    seenUrls.add(absoluteUrl);

    const isInternal = isInternalLink(absoluteUrl, currentDomain);
    if (filterInternalOnly && !isInternal) {
      continue;
    }

    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const rel = $(el).attr('rel')?.trim() || null;

    links.push({
      url: absoluteUrl,
      text,
      isInternal,
      rel,
    });

    if (
      options.discoverLinks &&
      isInternal &&
      matchesSpecificPageKeywords(absoluteUrl, text, options.specificPageKeywords ?? [])
    ) {
      discoveredUrls.push(absoluteUrl);
    }
  }

  return { links, discoveredUrls };
}


export function normalizeSpecificPageText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchesSpecificPageKeywords(
  url: string,
  anchorText: string,
  keywords: string[]
): boolean {
  if (keywords.length === 0) return true;

  let pathname = '';
  try {
    const rawPathname = new URL(url).pathname;
    try {
      pathname = decodeURIComponent(rawPathname);
    } catch {
      pathname = rawPathname;
    }
  } catch {
    return false;
  }

  const normalizedPathname = normalizeSpecificPageText(pathname);
  const normalizedAnchorText = normalizeSpecificPageText(anchorText);
  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeSpecificPageText(keyword);
    return (
      normalizedKeyword.length >= 2 &&
      (normalizedPathname.includes(normalizedKeyword) || normalizedAnchorText.includes(normalizedKeyword))
    );
  });
}
