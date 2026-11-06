import path from 'node:path';

const hostname = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');
const route = (url: URL) => url.pathname.replace(/\/(?:index|default)\.html?$/i, '/').replace(/\/+$/, '') || '/';
const relative = (from: string, to: string) => path.posix.relative(path.posix.dirname(from), to) || path.posix.basename(to);

/** Maps source-site navigation to actual exported files, never invented routes. */
export class HtmlNavigation {
  private readonly exact = new Map<string, string>();
  private readonly routes = new Map<string, Set<string>>();
  private readonly hosts = new Set<string>();

  constructor(pages: Array<{ url: string; path: string }>, targetUrl: string) {
    this.hosts.add(hostname(new URL(targetUrl)));
    for (const page of pages) {
      const url = new URL(page.url);
      this.hosts.add(hostname(url));
      this.exact.set(this.key(url), page.path);
      const key = hostname(url) + route(url);
      const files = this.routes.get(key) || new Set<string>();
      files.add(page.path);
      this.routes.set(key, files);
    }
  }

  private key(url: URL): string { return hostname(url) + route(url) + url.search; }

  resolve(url: URL, fromFile: string): { href: string; missing: boolean } | null {
    if (!this.hosts.has(hostname(url))) return null;
    let destination = this.exact.get(this.key(url));
    if (!destination) {
      const files = this.routes.get(hostname(url) + route(url));
      // Ignore tracking/query differences only when the exported route is unambiguous.
      if (files?.size === 1) destination = [...files][0];
    }
    if (!destination) return { href: '#', missing: true };
    const source = new URL(url.href);
    return { href: relative(fromFile, destination) + source.search + source.hash, missing: false };
  }
}
