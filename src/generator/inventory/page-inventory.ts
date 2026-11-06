import * as cheerio from 'cheerio';
import type { PageInventory, PageInventoryItem } from '../types.js';
import { normalizeUrl } from '../../core/domain/url-normalizer.js';

export interface RawScrapePageItem {
  url: string;
  rawData?: {
    html?: string | null;
    metadata?: {
      title?: string | null;
      description?: string | null;
      canonicalUrl?: string | null;
    } | null;
    headings?: Record<string, string[]> | null;
    images?: Array<{ src: string; alt?: string | null }> | null;
    links?: Array<{ url: string; text?: string }> | null;
  };
  normalizedData?: {
    title?: string | null;
    description?: string | null;
  };
}

/**
 * Normalizes an arbitrary page URL to a safe, valid Next.js App Router route path.
 * Examples:
 *   https://example.com/ -> '/'
 *   https://example.com/about.html -> '/about'
 *   https://example.com/blog/my-post/ -> '/blog/my-post'
 *   https://example.com/index.php?page=2 -> '/index'
 */
export function urlToNextRoute(pageUrl: string, rootUrl: string): string {
  try {
    const parsedPage = new URL(pageUrl);
    const parsedRoot = new URL(rootUrl);

    // If identical origin and pathname is '/' or empty
    if (parsedPage.origin === parsedRoot.origin && (parsedPage.pathname === '/' || parsedPage.pathname === '')) {
      return '/';
    }

    let pathname = parsedPage.pathname;

    // Remove index files (.html, .htm, .php, .asp, etc.)
    pathname = pathname.replace(/\/(index|default)\.(html?|php|asp[x]?|jsp)$/i, '');

    // Strip trailing .html, .htm, etc.
    pathname = pathname.replace(/\.(html?|php|asp[x]?|jsp)$/i, '');

    // Remove trailing slashes
    pathname = pathname.replace(/\/+$/, '');

    // Ensure leading slash
    if (!pathname.startsWith('/')) {
      pathname = `/${pathname}`;
    }

    // Clean up double slashes
    pathname = pathname.replace(/\/+/g, '/');

    // Clean non-safe route characters (replace with hyphen)
    const segments = pathname
      .split('/')
      .filter(Boolean)
      .map((seg) => seg.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
      .filter(Boolean);

    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
  } catch {
    return '/';
  }
}

/**
 * Creates a valid React component name from a route path or title.
 */
export function routeToComponentName(route: string): string {
  if (route === '/' || route === '') {
    return 'HomePage';
  }

  const parts = route
    .split('/')
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).replace(/[-_]([a-z0-9])/gi, (_, ch) => ch.toUpperCase()));

  const name = `${parts.join('')}Page`;
  return /^[A-Z]/.test(name) ? name : `Page${name}`;
}

export function buildPageInventory(
  jobId: string,
  targetUrl: string,
  domain: string,
  rawPages: RawScrapePageItem[]
): PageInventory {
  const normalizedRoot = normalizeUrl(targetUrl);
  const items: PageInventoryItem[] = [];
  const seenRoutes = new Set<string>();

  for (const page of rawPages) {
    const pageUrl = page.url;
    let route = urlToNextRoute(pageUrl, normalizedRoot);

    // Collision handling for routes
    if (seenRoutes.has(route)) {
      let counter = 2;
      while (seenRoutes.has(`${route}-${counter}`)) {
        counter++;
      }
      route = `${route}-${counter}`;
    }
    seenRoutes.add(route);

    const html = page.rawData?.html || '';
    const $ = cheerio.load(html);

    const sourceTitle =
      $('title').first().text().trim() ||
      page.rawData?.metadata?.title ||
      page.normalizedData?.title ||
      $('h1').first().text().trim() ||
      (route === '/' ? 'Home' : route.replace(/^\//, ''));
    const titleCharacters = Array.from(sourceTitle.replace(/\s+/g, ' ').trim());
    const title = titleCharacters.length > 60
      ? titleCharacters.slice(0, 57).join('').trimEnd() + '...'
      : titleCharacters.join('');

    const description =
      page.rawData?.metadata?.description ||
      $('meta[name="description"]').attr('content') ||
      null;

    const canonicalUrl =
      page.rawData?.metadata?.canonicalUrl ||
      $('link[rel="canonical"]').attr('href') ||
      null;

    const hasHeader = $('header, [role="banner"], .header, #header').length > 0;
    const hasFooter = $('footer, [role="contentinfo"], .footer, #footer').length > 0;
    const hasNav = $('nav, [role="navigation"], .nav, .navbar, #nav').length > 0;

    let headingsCount = 0;
    if (page.rawData?.headings) {
      headingsCount = Object.values(page.rawData.headings).reduce((acc, h) => acc + h.length, 0);
    } else {
      headingsCount = $('h1, h2, h3, h4, h5, h6').length;
    }

    const imagesCount = page.rawData?.images?.length ?? $('img').length;
    const linksCount = page.rawData?.links?.length ?? $('a[href]').length;

    items.push({
      url: pageUrl,
      route,
      title,
      description,
      canonicalUrl,
      componentName: routeToComponentName(route),
      headingsCount,
      imagesCount,
      linksCount,
      hasHeader,
      hasFooter,
      hasNav,
      hasHtml: Boolean(html.trim()),
      htmlBytes: Buffer.byteLength(html, 'utf8'),
    });
  }

  return {
    jobId,
    targetUrl: normalizedRoot,
    domain,
    pages: items,
    totalPages: items.length,
    routes: Array.from(seenRoutes),
  };
}
