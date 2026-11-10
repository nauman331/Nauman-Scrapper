import * as cheerio from 'cheerio';
import { cssUrlPattern, unquoteCssUrl } from './css-urls.js';

export interface DiscoveredAsset {
  originalUrl: string;
  sourcePageUrl: string;
  type: 'image' | 'video' | 'animation' | 'stylesheet' | 'font' | 'icon' | 'other';
  htmlTag?: string;
  suggestedLocalName: string;
}

export class AssetCollector {
  /**
   * Scans an HTML document for all external and relative assets that should be saved locally
   */
  collectAssets(html: string, pageUrl: string): DiscoveredAsset[] {
    const $ = cheerio.load(html, null, false);
    const assets: DiscoveredAsset[] = [];
    const seenUrls = new Set<string>();

    const addAsset = (rawUrl: string | undefined, type: DiscoveredAsset['type'], tag?: string) => {
      rawUrl = rawUrl && unquoteCssUrl(rawUrl);
      if (!rawUrl || /^(?:data:|blob:|javascript:|#)/i.test(rawUrl)) {
        return;
      }

      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(rawUrl.trim(), pageUrl).toString();
      } catch {
        return;
      }

      if (!/^https?:/i.test(absoluteUrl)) return;
      if (seenUrls.has(absoluteUrl)) return;
      seenUrls.add(absoluteUrl);

      const localName = this.generateLocalFilename(absoluteUrl, type);

      assets.push({
        originalUrl: absoluteUrl,
        sourcePageUrl: pageUrl,
        type,
        htmlTag: tag,
        suggestedLocalName: localName,
      });
    };

    // 1. Webflow Lottie JSON is runtime animation data, not an ordinary image.
    $('[data-animation-type="lottie"][data-src]').each((_, el) => {
      addAsset($(el).attr('data-src'), 'animation', 'webflow-lottie');
    });

    // 2. Images, responsive candidates, and lazy-loader variants.
    $('img, picture source, figure source:not(video source, audio source)').each((_, el) => {
      const tag = el.tagName === 'source' ? 'source' : 'img';
      for (const attribute of ['src', 'data-src', 'data-lazy-src', 'data-original']) {
        addAsset($(el).attr(attribute), 'image', tag);
      }
      for (const attribute of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
        const srcset = $(el).attr(attribute);
        if (!srcset) continue;
        for (const candidate of this.parseSrcset(srcset)) addAsset(candidate, 'image', tag);
      }
    });

    // Ordinary data-src values are promoted only on elements whose semantics identify
    // them as images. Arbitrary JSON-bearing data attributes remain untouched.
    $('[data-src]').each((_, el) => {
      if ($(el).attr('data-animation-type') === 'lottie') return;
      const value = $(el).attr('data-src');
      if (value && this.looksLikeImageUrl(value)) addAsset(value, 'image', el.tagName);
    });

    $('video').each((_, el) => {
      addAsset($(el).attr('poster'), 'image', 'video-poster');
      addAsset($(el).attr('src'), 'video', 'video');
    });
    $('video source').each((_, el) => addAsset($(el).attr('src'), 'video', 'media-source'));
    $('audio, audio source').each((_, el) => addAsset($(el).attr('src'), 'other', 'media-source'));
    $('object[data]').each((_, el) => addAsset($(el).attr('data'), 'other', 'object'));
    $('embed[src]').each((_, el) => addAsset($(el).attr('src'), 'other', 'embed'));
    $('input[type="image"][src]').each((_, el) => addAsset($(el).attr('src'), 'image', 'input-image'));

    // 3. SVG images and icons
    $('image').each((_, el) => {
      addAsset($(el).attr('href') || $(el).attr('xlink:href'), 'image', 'svg-image');
    });

    // 4. Stylesheets
    $('link[rel="stylesheet"]').each((_, el) => {
      addAsset($(el).attr('href'), 'stylesheet', 'link-css');
    });

    // 5. Icons and Favicons
    $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each((_, el) => {
      addAsset($(el).attr('href'), 'icon', 'link-icon');
    });

    // 6. Preloaded fonts and images. Metadata images are downloadable but remain metadata.
    $('link[rel="preload"][as="font"]').each((_, el) => {
      addAsset($(el).attr('href'), 'font', 'link-font');
    });
    $('link[rel="preload"][as="image"]').each((_, el) => addAsset($(el).attr('href'), 'image', 'link-image'));
    $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"]').each((_, el) => {
      addAsset($(el).attr('content'), 'image', 'metadata-image');
    });

    // 6. CSS inline url(...) background images
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const urlMatches = style.matchAll(cssUrlPattern());
      for (const match of urlMatches) {
        if (match[1]) addAsset(unquoteCssUrl(match[1]), 'image', 'inline-style');
      }
    });

    return assets;
  }

  /**
   * Collects all inline <style> block contents from an HTML document
   */
  collectInlineStyles(html: string): string[] {
    if (!html) return [];
    const $ = cheerio.load(html, null, false);
    const styles: string[] = [];
    $('style').each((_, el) => {
      const css = $(el).text().trim();
      if (css) styles.push(css);
    });
    return styles;
  }

  private generateLocalFilename(urlStr: string, type: DiscoveredAsset['type']): string {
    try {
      const parsed = new URL(urlStr);
      let filename = parsed.pathname.split('/').filter(Boolean).pop() || `asset_${Date.now()}`;
      filename = filename.split('?')[0].split('#')[0];

      // Clean characters
      filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

      // Ensure appropriate extension
      if (!filename.includes('.')) {
        if (type === 'animation') filename += '.json';
        else if (type === 'image') filename += '.png';
        else if (type === 'stylesheet') filename += '.css';
        else if (type === 'font') filename += '.woff2';
        else if (type === 'icon') filename += '.ico';
      }

      return filename;
    } catch {
      return `asset_${Date.now()}.${type === 'stylesheet' ? 'css' : 'png'}`;
    }
  }

  private parseSrcset(srcset: string): string[] {
    return srcset.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  }

  private looksLikeImageUrl(value: string): boolean {
    return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(value.trim());
  }
}

export const assetCollector = new AssetCollector();
