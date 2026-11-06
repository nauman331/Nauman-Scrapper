import * as cheerio from 'cheerio';
import { canonicalDomHash } from '../codegen/jsx-transformer.js';
import type { SharedComponentDefinition } from '../types.js';
import type { ExtractedPageStructure } from './dom-analyzer.js';

export interface PageStructureMap {
  route: string;
  structure: ExtractedPageStructure;
}

export class ComponentDetector {
  /**
   * Analyzes all pages to identify shared layout components (Header, Footer, Navigation)
   * and repeated section blocks.
   */
  detectSharedComponents(pages: PageStructureMap[]): SharedComponentDefinition[] {
    const components: SharedComponentDefinition[] = [];

    if (pages.length === 0) return components;

    // 1. Detect Shared Header
    const headerCandidates: Map<string, { html: string; routes: string[] }> = new Map();

    for (const page of pages) {
      if (page.structure.headerHtml) {
        const hash = this.normalizeAndHash(page.structure.headerHtml);
        const existing = headerCandidates.get(hash);
        if (existing) {
          existing.routes.push(page.route);
        } else {
          headerCandidates.set(hash, {
            html: page.structure.headerHtml,
            routes: [page.route],
          });
        }
      }
    }

    // Pick best header (most common, or root page header)
    let primaryHeader: { html: string; routes: string[] } | null = null;
    let maxHeaderRoutes = 0;
    for (const [, candidate] of headerCandidates) {
      if (candidate.routes.length > maxHeaderRoutes) {
        maxHeaderRoutes = candidate.routes.length;
        primaryHeader = candidate;
      }
    }

    if (primaryHeader && (pages.length === 1 || primaryHeader.routes.length >= 2)) {
      components.push({
        name: 'Header',
        category: 'layout',
        filePath: 'components/layout/Header.tsx',
        jsxCode: '', // Populated by codegen
        isClientComponent: this.hasInteractiveElements(primaryHeader.html),
        instancesCount: primaryHeader.routes.length,
        usedInRoutes: primaryHeader.routes,
        sourceHtml: primaryHeader.html,
      });
    }

    // 2. Detect Shared Footer
    const footerCandidates: Map<string, { html: string; routes: string[] }> = new Map();

    for (const page of pages) {
      if (page.structure.footerHtml) {
        const hash = this.normalizeAndHash(page.structure.footerHtml);
        const existing = footerCandidates.get(hash);
        if (existing) {
          existing.routes.push(page.route);
        } else {
          footerCandidates.set(hash, {
            html: page.structure.footerHtml,
            routes: [page.route],
          });
        }
      }
    }

    let primaryFooter: { html: string; routes: string[] } | null = null;
    let maxFooterRoutes = 0;
    for (const [, candidate] of footerCandidates) {
      if (candidate.routes.length > maxFooterRoutes) {
        maxFooterRoutes = candidate.routes.length;
        primaryFooter = candidate;
      }
    }

    if (primaryFooter && (pages.length === 1 || primaryFooter.routes.length >= 2)) {
      components.push({
        name: 'Footer',
        category: 'layout',
        filePath: 'components/layout/Footer.tsx',
        jsxCode: '',
        isClientComponent: this.hasInteractiveElements(primaryFooter.html),
        instancesCount: primaryFooter.routes.length,
        usedInRoutes: primaryFooter.routes,
        sourceHtml: primaryFooter.html,
      });
    }

    // 3. Detect Shared Navigation (if standalone from Header)
    const navCandidates: Map<string, { html: string; routes: string[] }> = new Map();
    for (const page of pages) {
      if (page.structure.navHtml) {
        const hash = this.normalizeAndHash(page.structure.navHtml);
        const existing = navCandidates.get(hash);
        if (existing) {
          existing.routes.push(page.route);
        } else {
          navCandidates.set(hash, {
            html: page.structure.navHtml,
            routes: [page.route],
          });
        }
      }
    }

    for (const [, candidate] of navCandidates) {
      if (candidate.routes.length >= 2 || (candidate.routes.includes('/') && pages.length === 1)) {
        components.push({
          name: 'Navigation',
          category: 'layout',
          filePath: 'components/layout/Navigation.tsx',
          jsxCode: '',
          isClientComponent: this.hasInteractiveElements(candidate.html),
          instancesCount: candidate.routes.length,
          usedInRoutes: candidate.routes,
          sourceHtml: candidate.html,
        });
        break;
      }
    }

    // 4. Detect Repeated Sections across multiple pages
    const sectionCandidates: Map<string, { name: string; html: string; routes: string[] }> = new Map();
    for (const page of pages) {
      for (const sec of page.structure.sections) {
        const hash = this.normalizeAndHash(sec.html);
        const existing = sectionCandidates.get(hash);
        if (existing) {
          if (!existing.routes.includes(page.route)) {
            existing.routes.push(page.route);
          }
        } else {
          sectionCandidates.set(hash, {
            name: sec.name,
            html: sec.html,
            routes: [page.route],
          });
        }
      }
    }

    for (const [, candidate] of sectionCandidates) {
      if (candidate.routes.length >= 2) {
        const componentName = candidate.name.endsWith('Section') ? candidate.name : `Shared${candidate.name}Section`;
        components.push({
          name: componentName,
          category: 'sections',
          filePath: `components/sections/${componentName}.tsx`,
          jsxCode: '',
          isClientComponent: this.hasInteractiveElements(candidate.html),
          instancesCount: candidate.routes.length,
          usedInRoutes: candidate.routes,
          sourceHtml: candidate.html,
        });
      }
    }

    return components;
  }

  /** Share only canonically identical DOM, including content and all attributes. */
  private normalizeAndHash(html: string): string {
    return canonicalDomHash(html);
  }

  private hasInteractiveElements(html: string): boolean {
    const $ = cheerio.load(html, null, false);
    return (
      $('button, input, select, textarea, form, [data-toggle], [data-bs-toggle], details, dialog, [aria-expanded], [aria-haspopup]').length > 0
    );
  }
}

export const componentDetector = new ComponentDetector();
