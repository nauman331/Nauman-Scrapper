import type { CheerioAPI } from 'cheerio';
import type { CustomSelectorConfig } from '../schemas/extraction.schema.js';

export function extractCustomSelectors(
  $: CheerioAPI,
  selectors: CustomSelectorConfig[]
): Record<string, unknown> {
  const customData: Record<string, unknown> = {};

  for (const rule of selectors) {
    const elements = $(rule.selector);

    if (elements.length === 0) {
      customData[rule.name] = rule.multiple ? [] : null;
      continue;
    }

    const extractValue = (index: number): unknown => {
      const el = elements.eq(index);

      let val: string | null = null;
      if (rule.attribute) {
        val = el.attr(rule.attribute) || null;
      } else if (rule.transform === 'html') {
        val = el.html();
      } else {
        val = el.text();
      }

      if (val === null) return null;

      if (rule.transform === 'trim' || rule.transform === 'text') {
        val = val.replace(/\s+/g, ' ').trim();
      }

      if (rule.transform === 'number') {
        const cleaned = val.replace(/[^0-9.-]/g, '');
        const num = parseFloat(cleaned);
        return Number.isNaN(num) ? null : num;
      }

      return val;
    };

    if (rule.multiple) {
      const values: unknown[] = [];
      elements.each((i) => {
        const v = extractValue(i);
        if (v !== null) values.push(v);
      });
      customData[rule.name] = values;
    } else {
      customData[rule.name] = extractValue(0);
    }
  }

  return customData;
}
