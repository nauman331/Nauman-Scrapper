import type { CheerioAPI } from 'cheerio';
import type { ExtractedHeadings } from '../schemas/extraction.schema.js';

export function extractHeadings($: CheerioAPI): ExtractedHeadings {
  const getTexts = (tag: string): string[] => {
    const list: string[] = [];
    $(tag).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) {
        list.push(text);
      }
    });
    return list;
  };

  return {
    h1: getTexts('h1'),
    h2: getTexts('h2'),
    h3: getTexts('h3'),
    h4: getTexts('h4'),
    h5: getTexts('h5'),
    h6: getTexts('h6'),
  };
}

export function extractMainText($: CheerioAPI): string | null {
  // Clone to avoid mutating original DOM
  const clone = $.load($.html());

  // Remove non-content elements
  clone('script, style, noscript, svg, iframe, nav, footer, header, form, button, [aria-hidden="true"]').remove();

  // Prefer article, main, or role=main if available
  let contentEl = clone('main, article, [role="main"]').first();
  if (!contentEl.length) {
    contentEl = clone('body');
  }

  const rawText = contentEl.text();
  // Normalize whitespace
  const clean = rawText
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

  return clean.length > 0 ? clean : null;
}
