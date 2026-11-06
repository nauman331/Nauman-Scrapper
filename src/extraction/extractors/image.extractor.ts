import type { CheerioAPI } from 'cheerio';
import type { ExtractedImage } from '../schemas/extraction.schema.js';
import { normalizeUrl } from '../../core/domain/url-normalizer.js';

export function extractImages($: CheerioAPI, currentUrl: string, maxImages = 50): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seenSrcs = new Set<string>();

  for (const el of $('img').toArray()) {
    if (images.length >= maxImages) {
      break;
    }

    const rawSrc = $(el).attr('src') || $(el).attr('data-src');
    if (!rawSrc || rawSrc.startsWith('data:')) {
      continue;
    }

    let absoluteSrc: string;
    try {
      absoluteSrc = normalizeUrl(rawSrc.trim(), currentUrl);
    } catch {
      continue;
    }

    if (seenSrcs.has(absoluteSrc)) {
      continue;
    }
    seenSrcs.add(absoluteSrc);

    const alt = $(el).attr('alt')?.trim() || null;
    const widthAttr = $(el).attr('width');
    const heightAttr = $(el).attr('height');

    const width = widthAttr ? parseInt(widthAttr, 10) : undefined;
    const height = heightAttr ? parseInt(heightAttr, 10) : undefined;

    images.push({
      src: absoluteSrc,
      alt,
      width: Number.isNaN(width) ? undefined : width,
      height: Number.isNaN(height) ? undefined : height,
    });
  }

  // Keep the existing img extraction/order above; append responsive and lazy
  // variants plus semantic figure/picture sources without duplicating URLs.
  for (const el of $('img, picture source, figure source:not(video source, audio source)').toArray()) {
    const node = $(el);
    const candidates = ['src', 'data-src'].map(attribute => node.attr(attribute)).filter(Boolean) as string[];
    for (const attribute of ['srcset', 'data-srcset']) {
      for (const part of (node.attr(attribute) || '').split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (url) candidates.push(url);
      }
    }
    for (const raw of candidates) {
      if (images.length >= maxImages) break;
      let url: URL;
      try { url = new URL(raw.trim(), currentUrl); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const src = normalizeUrl(url.href);
      if (seenSrcs.has(src)) continue;
      seenSrcs.add(src);
      images.push({ src, alt: node.attr('alt')?.trim() || null });
    }
  }
  return images;
}
