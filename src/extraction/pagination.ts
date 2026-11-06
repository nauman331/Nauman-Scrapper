import type { CheerioAPI } from 'cheerio';
import type { PaginationConfig } from './schemas/extraction.schema.js';
import { normalizeUrl } from '../core/domain/url-normalizer.js';

export function extractNextPageUrl(
  $: CheerioAPI,
  currentUrl: string,
  config?: PaginationConfig
): string | null {
  if (!config) return null;

  // Next page by CSS selector (e.g. "a.next", "a[rel='next']")
  if (config.nextSelector) {
    const nextEl = $(config.nextSelector).first();
    const href = nextEl.attr('href') || (nextEl.is('a') ? nextEl.attr('href') : nextEl.find('a').attr('href'));

    if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      try {
        return normalizeUrl(href, currentUrl);
      } catch {
        return null;
      }
    }
  }

  // Next page by incrementing page query param (e.g. ?page=1 -> ?page=2)
  if (config.pageParam) {
    try {
      const url = new URL(currentUrl);
      const currentPage = parseInt(url.searchParams.get(config.pageParam) || '1', 10);
      if (!Number.isNaN(currentPage) && currentPage < config.maxPages) {
        url.searchParams.set(config.pageParam, String(currentPage + 1));
        return url.toString();
      }
    } catch {
      return null;
    }
  }

  return null;
}
