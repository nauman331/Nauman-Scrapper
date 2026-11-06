import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { urlToNextRoute } from '../inventory/page-inventory.js';

export interface ExtractedPageStructure {
  headTitle: string;
  bodyContext: { id?: string; className?: string };
  metaTags: Array<{ name?: string; property?: string; content: string }>;
  headerHtml: string | null;
  footerHtml: string | null;
  navHtml: string | null;
  /** Intact body fragment for source-preserving page composition. Optional for legacy callers. */
  bodyContentHtml?: string;
  mainContentHtml: string;
  sections: Array<{ name: string; html: string; tagName: string }>;
  externalStylesheets: string[];
  inlineStyles: string[];
  faviconUrl: string | null;
}

export class DomAnalyzer {
  /**
   * Analyzes an HTML document and extracts structural regions (header, footer, nav, main, sections)
   */
  analyzePage(html: string, pageUrl: string, _rootUrl?: string): ExtractedPageStructure {
    const $ = cheerio.load(html);

    // Extract title & metadata
    const headTitle = $('title').first().text().trim() || 'Untitled';
    const metaTags: Array<{ name?: string; property?: string; content: string }> = [];

    $('meta').each((_, el) => {
      const name = $(el).attr('name');
      const property = $(el).attr('property');
      const content = $(el).attr('content');
      if (content && (name || property)) {
        metaTags.push({ name: name || undefined, property: property || undefined, content });
      }
    });

    // Favicon
    let faviconUrl = $('link[rel="icon"], link[rel="shortcut icon"]').attr('href') || null;
    if (faviconUrl) {
      try {
        faviconUrl = new URL(faviconUrl, pageUrl).toString();
      } catch {
        // ignore
      }
    }

    // External Stylesheets
    const externalStylesheets: string[] = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          externalStylesheets.push(new URL(href, pageUrl).toString());
        } catch {
          externalStylesheets.push(href);
        }
      }
    });

    // Inline Styles
    const inlineStyles: string[] = [];
    $('style').each((_, el) => {
      const css = $(el).text().trim();
      if (css) inlineStyles.push(css);
    });

    // Capture source body before legacy sanitization/chrome extraction mutates the DOM.
    const bodyContentHtml = $('body').first().html() || '';

    // Remove tracking/third-party scripts, iframes, and ads for the legacy output.
    $('script, noscript, iframe[src*="doubleclick"], iframe[src*="google"]').remove();

    const body = $('body').first();
    const bodyContext = {
      id: body.attr('id') || undefined,
      className: body.attr('class') || undefined,
    };

    // Mark exact winning layout candidates before cloning. The marker survives cloning,
    // unlike Cheerio node identity, and avoids deleting unrelated hero wrappers.
    const headerEl = $('header, [role="banner"], .header, #header').first();
    const footerEl = $('footer, [role="contentinfo"], .footer, #footer').first();
    const headerHtml = headerEl.length ? $.html(headerEl) : null;
    const footerHtml = footerEl.length ? $.html(footerEl) : null;
    if (headerEl.length) headerEl.attr('data-next-layout-node', 'header');
    if (footerEl.length) footerEl.attr('data-next-layout-node', 'footer');

    // Identify Nav
    let navHtml: string | null = null;
    const navEl = $('nav, [role="navigation"]').first();
    if (navEl.length > 0 && (!headerEl.length || !headerEl.find(navEl).length)) {
      navHtml = $.html(navEl);
    }

    // Identify Sections
    const sections: Array<{ name: string; html: string; tagName: string }> = [];
    const mainEl = $('main, #main, #content, .content, #app, #__next, body').first();

    const targetContainer = mainEl.length > 0 ? mainEl : $('body');

    // Clone container to dissect sections
    const contentClone = cheerio.load($.html(targetContainer));

    // Remove only exact selected nodes. Also remove a sibling sticky duplicate when it
    // has the same navigation signature; wrappers containing substantive hero content stay.
    const selectedHeader = contentClone('[data-next-layout-node="header"]');
    const headerSignature = this.chromeSignature(selectedHeader);
    if (headerSignature) {
      contentClone('.header, #header, header, [role="banner"]').each((_, el) => {
        const candidate = contentClone(el);
        if (!candidate.is('[data-next-layout-node="header"]') && this.isHeaderOnlyChrome(candidate) && this.chromeSignature(candidate) === headerSignature) {
          candidate.remove();
        }
      });
    }
    contentClone('[data-next-layout-node="header"], [data-next-layout-node="footer"]').remove();

    let sectionIndex = 1;
    // Section source comes from the intact body, never the dissected legacy clone.
    const sectionSource = cheerio.load(bodyContentHtml, null, false);
    const sectionCandidates = sectionSource('section, article, .section, .block, [data-section]').toArray();

    if (sectionCandidates.length > 0) {
      for (const el of sectionCandidates) {
        const tagName = (el as { tagName?: string }).tagName || 'section';
        const id = sectionSource(el).attr('id') || sectionSource(el).attr('class') || `section-${sectionIndex}`;
        const safeName = this.sanitizeSectionName(id, sectionIndex);
        sections.push({
          name: safeName,
          html: sectionSource.html(el),
          tagName,
        });
        sectionIndex++;
      }
    }

    const mainContentHtml = contentClone.html() || '';

    return {
      headTitle,
      bodyContext,
      metaTags,
      headerHtml,
      footerHtml,
      navHtml,
      bodyContentHtml,
      mainContentHtml,
      sections,
      externalStylesheets,
      inlineStyles,
      faviconUrl,
    };
  }


  private chromeSignature(node: cheerio.Cheerio<AnyNode>): string {
    if (!node.length) return '';
    return node.find('a[href]').map((_, el) => node.find(el).attr('href') || '').get().filter(Boolean).join('|');
  }

  private isHeaderOnlyChrome(node: cheerio.Cheerio<AnyNode>): boolean {
    if (!node.length) return false;
    const linkCount = node.find('a[href]').length;
    const text = node.text().replace(/\s+/g, ' ').trim();
    const hasHeroContent = node.find('h1, h2, article, section, [class*=hero], [class*=banner-content]').length > 0;
    return linkCount >= 2 && text.length < 500 && !hasHeroContent;
  }

  private sanitizeSectionName(raw: string, fallbackIdx: number): string {
    const cleaned = raw
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');

    return cleaned.length > 2 ? `${cleaned}Section` : `Section${fallbackIdx}`;
  }

  /**
   * Rewrites internal href attributes in HTML to target the generated Next.js routes
   */
  rewriteInternalLinks(html: string, rootUrl: string, _knownUrls?: string[]): string {
    const $ = cheerio.load(html, null, false);

    $('a[href]').each((_, el) => {
      const rawHref = $(el).attr('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return;
      }

      try {
        const resolved = new URL(rawHref, rootUrl).toString();
        // Check if internal domain
        const rootDomain = new URL(rootUrl).hostname.replace(/^www\./i, '');
        const targetDomain = new URL(resolved).hostname.replace(/^www\./i, '');

        if (rootDomain === targetDomain) {
          const nextRoute = urlToNextRoute(resolved, rootUrl);
          $(el).attr('href', nextRoute);
        }
      } catch {
        // Keep original
      }
    });

    return $.html();
  }
}

export const domAnalyzer = new DomAnalyzer();
