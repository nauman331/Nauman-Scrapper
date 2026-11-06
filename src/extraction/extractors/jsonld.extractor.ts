import type { CheerioAPI } from 'cheerio';
import { logger } from '../../monitoring/logger.js';

export function extractJsonLd($: CheerioAPI): unknown[] {
  const results: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;

    try {
      // Clean comments and whitespace
      const cleaned = raw.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1').trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        results.push(parsed);
      }
    } catch {
      logger.debug('Failed to parse JSON-LD script block');
    }
  });

  return results;
}
