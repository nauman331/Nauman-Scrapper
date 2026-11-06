import type { CheerioAPI } from 'cheerio';
import type { ExtractedMetadata } from '../schemas/extraction.schema.js';
import { normalizeUrl } from '../../core/domain/url-normalizer.js';

export function extractMetadata($: CheerioAPI, currentUrl: string): ExtractedMetadata {
  const getAttr = (selector: string, attr: string): string | null => {
    const val = $(selector).attr(attr);
    return val && val.trim() ? val.trim() : null;
  };

  const title =
    $('title').text().trim() ||
    getAttr('meta[property="og:title"]', 'content') ||
    getAttr('meta[name="twitter:title"]', 'content') ||
    null;

  const description =
    getAttr('meta[name="description"]', 'content') ||
    getAttr('meta[property="og:description"]', 'content') ||
    getAttr('meta[name="twitter:description"]', 'content') ||
    null;

  let rawCanonical = getAttr('link[rel="canonical"]', 'href');
  let canonicalUrl: string | null = null;
  if (rawCanonical) {
    try {
      canonicalUrl = normalizeUrl(rawCanonical, currentUrl);
    } catch {
      canonicalUrl = rawCanonical;
    }
  }

  const ogTitle = getAttr('meta[property="og:title"]', 'content');
  const ogDescription = getAttr('meta[property="og:description"]', 'content');
  const rawOgImage = getAttr('meta[property="og:image"]', 'content');
  const ogImage = rawOgImage ? normalizeUrl(rawOgImage, currentUrl) : null;

  const twitterTitle = getAttr('meta[name="twitter:title"]', 'content');
  const twitterDescription = getAttr('meta[name="twitter:description"]', 'content');

  const rawFavicon =
    getAttr('link[rel="icon"]', 'href') ||
    getAttr('link[rel="shortcut icon"]', 'href') ||
    getAttr('link[rel="apple-touch-icon"]', 'href');
  const favicon = rawFavicon ? normalizeUrl(rawFavicon, currentUrl) : null;

  const language = $('html').attr('lang')?.trim() || null;

  return {
    title,
    description,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImage,
    twitterTitle,
    twitterDescription,
    favicon,
    language,
  };
}
