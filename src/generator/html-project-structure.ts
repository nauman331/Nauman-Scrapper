import path from 'node:path';
import type { DownloadedAsset } from './types.js';

const slug = (value: string) => value.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) || 'page';
const urlKey = (value: string) => { const url = new URL(value); url.hash = ''; return url.href; };

/** URL paths inform page names, never the generated directory hierarchy. */
export function mapHtmlPageFiles(urls: string[], targetUrl: string) {
  const home = Math.max(0, urls.findIndex(url => urlKey(url) === urlKey(targetUrl)));
  const used = new Set<string>();
  return urls.map((url, index) => {
    const parsed = new URL(url);
    let base = path.posix.basename(parsed.pathname.replace(/\/+$/, '')).replace(/\.[a-z0-9]+$/i, '');
    if (!base || /^(index|default)$/i.test(base)) base = path.posix.basename(path.posix.dirname(parsed.pathname)) || 'page';
    const name = slug(base);
    let unique = name;
    for (let counter = 2; used.has(unique); counter++) unique = `${name}-${counter}`;
    used.add(unique);
    return { url, path: index === home ? 'index.html' : `pages/${unique}.html`, cssPath: index === home ? 'css/custom.css' : `css/pages/${unique}.css` };
  });
}

export function htmlAssetPath(asset: DownloadedAsset): string {
  const filename = path.posix.basename(asset.publicUrl);
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error('Unsafe downloaded asset filename.');
  if (asset.isSvg) return `assets/svgs/${filename}`;
  if (asset.isFont) return `assets/fonts/${filename}`;
  if (asset.isStylesheet) return `css/source/${filename}`;
  if (/^video\//i.test(asset.mimeType)) return `assets/videos/${filename}`;
  if (/^audio\//i.test(asset.mimeType)) return `assets/audio/${filename}`;
  const source = new URL(asset.originalUrl).pathname.toLowerCase();
  const category = asset.publicUrl.startsWith('/icons/') || /(?:icon|favicon)/.test(source) ? 'icons'
    : /logo/.test(source) ? 'logo'
    : /(?:banner|hero)/.test(source) ? 'banners'
    : /(?:background|(?:^|[\/_-])bg(?:[\/_.-]|$))/.test(source) ? 'backgrounds'
    : /(?:product|item|cover)/.test(source) ? 'products' : 'common';
  return `assets/images/${category}/${filename}`;
}
