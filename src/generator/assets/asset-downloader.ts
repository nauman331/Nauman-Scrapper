import crypto from 'node:crypto';
import path from 'node:path';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import { validateUrlForSsrf } from '../../core/ssrf/ssrf-validator.js';
import { conversionStorage } from '../storage.js';
import type { DiscoveredAsset } from './asset-collector.js';
import type { DownloadedAsset } from '../types.js';
import { logger } from '../../monitoring/logger.js';
import { cssUrlPattern, unquoteCssUrl } from './css-urls.js';
import { fetchThroughProxy, fetchProxyAsset } from '../../proxies/proxy-fetch.js';

const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per asset limit
const FETCH_TIMEOUT_MS = 10000;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function downloadError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.message, cause?.code, cause?.message].filter(Boolean).join(': ');
}

/** Bounded retries; redirects are manually validated so retries never bypass SSRF. */
async function fetchStylesheet(url: string, proxyUrl?: string): Promise<{ buffer: Buffer; url: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let target = url;
      for (let redirects = 0; redirects <= 5; redirects++) {
        const ssrf = await validateUrlForSsrf(target);
        if (!ssrf.valid) throw Object.assign(new Error(`Blocked stylesheet URL: ${ssrf.error || 'SSRF policy'}`), { permanent: true });
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', Accept: 'text/css,*/*;q=0.1' };
        const response = proxyUrl
          ? await fetchThroughProxy(target, proxyUrl, { signal: controller.signal, headers, maxBytes: MAX_ASSET_SIZE_BYTES })
          : await fetch(target, { signal: controller.signal, redirect: 'manual', headers });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 5) throw Object.assign(new Error('Invalid stylesheet redirect or redirect limit exceeded'), { permanent: true });
          target = new URL(location, target).href;
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw Object.assign(new Error(`HTTP ${response.status}`), { permanent: !RETRYABLE_STATUSES.has(response.status) });
        }
        if (/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) {
          await response.body?.cancel();
          throw Object.assign(new Error('Expected CSS but received HTML (possible access challenge)'), { permanent: true });
        }
        const reader = response.body?.getReader();
        const chunks: Buffer[] = [];
        let size = 0;
        if (reader) {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > MAX_ASSET_SIZE_BYTES) {
                await reader.cancel();
                throw Object.assign(new Error('Exceeded 10MB size limit'), { permanent: true });
              }
              chunks.push(Buffer.from(value));
            }
          } finally { reader.releaseLock(); }
        }
        return { buffer: Buffer.concat(chunks), url: target };
      }
    } catch (error) {
      lastError = error;
      if ((error as { permanent?: boolean })?.permanent || attempt === 2) throw error;
    } finally { clearTimeout(timeout); }
    // Abortable network attempts are bounded; short backoff avoids hammering the host.
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError;
}
export interface InlineStyleSource {
  css: string;
  sourceUrl: string;
}

export interface AssetResolutionOptions {
  /** Namespace Next.js assets without changing legacy public paths by default. */
  assetRoot?: 'cloned-assets';
  /** Set false when root-relative CSS URLs still belong to the source website. */
  generatedPublicAssetUrls?: boolean;
  /** Server-resolved credentials; never included in generated files or public records. */
  proxyUrl?: string;
  /** Standalone Tailwind sources in DOM order, retaining link/style media conditions. */
  cssSources?: Array<{ asset?: DiscoveredAsset; css?: string; sourceUrl: string; media?: string }>;
}

export interface AssetResolutionResult {
  downloadedAssets: DownloadedAsset[];
  missingAssets: string[];
  consolidatedCss: string;
}

export class AssetDownloader {
  /**
   * Safely downloads collected assets, saves them to public/, consolidates CSS,
   * resolves fonts/assets referenced inside CSS, and rewrites paths to safe Next.js URLs.
   */
  async resolveAssets(
    conversionId: string,
    discoveredAssets: DiscoveredAsset[],
    inlineStyles: Array<string | InlineStyleSource> = [],
    options: AssetResolutionOptions = {}
  ): Promise<AssetResolutionResult> {
    const downloaded: DownloadedAsset[] = [];
    const missing: string[] = [];
    const cssSnippets: string[] = [];
    const seenHashes = new Map<string, DownloadedAsset>();
    const seenUrls = new Set<string>();

    const context = {
      downloaded,
      missing,
      seenUrls,
      seenHashes,
      assetRoot: options.assetRoot,
      generatedPublicAssetUrls: options.generatedPublicAssetUrls,
      proxyUrl: options.proxyUrl,
    };

    // 1. Download discovered HTML assets (images, fonts, icons, stylesheets)
    for (const asset of discoveredAssets) {
      if (asset.type === 'stylesheet') {
        // Download stylesheet, parse internal url(...) assets, and rewrite
        if (!options.cssSources) await this.downloadAndProcessStylesheet(conversionId, asset, cssSnippets, context);
      } else {
        await this.downloadAsset(
          conversionId,
          asset.originalUrl,
          asset.type,
          asset.suggestedLocalName,
          context
        );
      }
    }

    // 2. Process inline styles from pages
    for (const source of options.cssSources || []) {
      const snippets: string[] = [];
      if (source.asset) await this.downloadAndProcessStylesheet(conversionId, source.asset, snippets, context);
      else if (source.css) snippets.push(await this.processAndRewriteCss(conversionId, source.css, source.sourceUrl, context));
      const css = snippets.join('\n');
      if (css) cssSnippets.push(source.media ? `@media ${source.media}{${css}}` : css);
    }
    for (const inline of options.cssSources ? [] : inlineStyles) {
      const rawText = typeof inline === 'string' ? inline : inline.css;
      const baseUrl =
        typeof inline === 'object' && inline.sourceUrl
          ? inline.sourceUrl
          : discoveredAssets[0]?.sourcePageUrl || 'https://localhost';

      if (rawText && rawText.trim()) {
        const processed = await this.processAndRewriteCss(conversionId, rawText, baseUrl, context);
        cssSnippets.push(processed);
      }
    }

    // 3. Build consolidated CSS
    let consolidatedCss = cssSnippets.join('\n\n/* --- Next Section Stylesheet --- */\n\n');

    // 4. Ensure any remaining url(...) in consolidated CSS matching downloaded originalUrls are rewritten
    for (const item of downloaded) {
      if (item.isImage || item.isFont) {
        const escaped = item.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        consolidatedCss = consolidatedCss.replace(new RegExp(escaped, 'g'), item.publicUrl);
      }
    }

    // Prefer matching downloaded assets over malformed encoded remote URLs.
    consolidatedCss = this.localizeDownloadedAssetUrls(consolidatedCss, downloaded);

    // 5. Final safety net: Convert ANY remaining relative url(...) to absolute so Webpack never crashes
    const defaultBaseUrl = discoveredAssets[0]?.sourcePageUrl || 'https://localhost';
    consolidatedCss = this.sanitizeRemainingRelativeUrls(consolidatedCss, defaultBaseUrl);

    return {
      downloadedAssets: downloaded,
      missingAssets: missing,
      consolidatedCss,
    };
  }

  /**
   * Downloads a stylesheet, parses all referenced font/image assets inside it,
   * downloads them, rewrites URLs, and saves both the local stylesheet file and in-memory snippet.
   */
  async downloadAndProcessStylesheet(
    conversionId: string,
    asset: DiscoveredAsset,
    cssSnippets: string[],
    context: {
      downloaded: DownloadedAsset[];
      missing: string[];
      seenUrls: Set<string>;
      seenHashes: Map<string, DownloadedAsset>;
      assetRoot?: 'cloned-assets';
      generatedPublicAssetUrls?: boolean;
      /** Server-resolved credentials; never included in generated files or public records. */
      proxyUrl?: string;
    }
  ): Promise<void> {
    if (context.seenUrls.has(asset.originalUrl)) return;
    context.seenUrls.add(asset.originalUrl);

    // SSRF validation
    const ssrf = await validateUrlForSsrf(asset.originalUrl);
    if (!ssrf.valid) {
      logger.warn({ url: asset.originalUrl, error: ssrf.error }, 'Asset download blocked by SSRF check');
      context.missing.push(`${asset.originalUrl} (Blocked by SSRF policy)`);
      return;
    }

    try {
      const fetched = await fetchStylesheet(asset.originalUrl, context.proxyUrl);
      const rawBuffer = fetched.buffer;

      const rawCss = rawBuffer.toString('utf8');

      // Process and rewrite font/media URLs inside CSS
      const rewrittenCss = await this.processAndRewriteCss(conversionId, rawCss, fetched.url, context);

      cssSnippets.push(rewrittenCss);

      // Save rewritten CSS file to public/css/
      const finalBuffer = Buffer.from(rewrittenCss, 'utf8');
      const hash = crypto.createHash('sha256').update(finalBuffer).digest('hex').slice(0, 12);
      const safeFilename = `${hash}_${
        asset.suggestedLocalName.endsWith('.css')
          ? asset.suggestedLocalName
          : `${asset.suggestedLocalName}.css`
      }`;
      const publicUrl = path.posix.join('/', context.assetRoot ?? '', 'css', safeFilename);
      const relativeProjectFile = `public${publicUrl}`;

      await conversionStorage.writeFileSafe(conversionId, relativeProjectFile, finalBuffer);

      const assetRecord: DownloadedAsset = {
        originalUrl: asset.originalUrl,
        localPath: relativeProjectFile,
        publicUrl,
        mimeType: 'text/css',
        sizeBytes: finalBuffer.length,
        hash,
        isSvg: false,
        isFont: false,
        isStylesheet: true,
        isImage: false,
      };

      context.seenHashes.set(hash, assetRecord);
      context.downloaded.push(assetRecord);
    } catch (err: unknown) {
      const errorMsg = downloadError(err);
      logger.warn({ url: asset.originalUrl, error: errorMsg }, 'Failed to download stylesheet');
      context.missing.push(`${asset.originalUrl} (${errorMsg})`);
    }
  }

  /**
   * Safely downloads a single binary or text asset, deduping by URL and SHA256 hash.
   */
  async downloadAsset(
    conversionId: string,
    urlStr: string,
    typeHint: DiscoveredAsset['type'],
    suggestedName: string | undefined,
    context: {
      downloaded: DownloadedAsset[];
      missing: string[];
      seenUrls: Set<string>;
      seenHashes: Map<string, DownloadedAsset>;
      assetRoot?: 'cloned-assets';
      generatedPublicAssetUrls?: boolean;
      /** Server-resolved credentials; never included in generated files or public records. */
      proxyUrl?: string;
    }
  ): Promise<DownloadedAsset | null> {
    if (context.seenUrls.has(urlStr)) {
      return context.downloaded.find((d) => d.originalUrl === urlStr) || null;
    }
    context.seenUrls.add(urlStr);

    // SSRF validation
    const ssrf = await validateUrlForSsrf(urlStr);
    if (!ssrf.valid) {
      logger.warn({ url: urlStr, error: ssrf.error }, 'Asset download blocked by SSRF check');
      context.missing.push(`${urlStr} (Blocked by SSRF policy)`);
      return null;
    }

    // Next.js optimizer URLs are runtime endpoints, often blocked outside the
    // source browser. Download their original image once and keep an alias for
    // every responsive optimizer URL so existing HTML rewriting remains exact.
    if (typeHint === 'image') {
      try {
        const optimizer = new URL(urlStr);
        if (optimizer.pathname.endsWith('/_next/image')) {
          const raw = optimizer.searchParams.get('url');
          if (raw) {
            const original = new URL(raw, optimizer.origin);
            if (['http:', 'https:'].includes(original.protocol) && !original.pathname.endsWith('/_next/image')) {
              const image = await this.downloadAsset(conversionId, original.href, 'image', undefined, context);
              if (image) {
                const alias = { ...image, originalUrl: urlStr };
                context.downloaded.push(alias);
                return alias;
              }
              // If the original is unavailable, still try the optimizer below.
            }
          }
        }
      } catch { /* Malformed optimizer URLs use the normal download path. */ }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: '*/*',
      };
      let response: Response;
      try {
        response = context.proxyUrl
          ? await fetchProxyAsset(urlStr, context.proxyUrl, { signal: controller.signal, headers, maxBytes: MAX_ASSET_SIZE_BYTES })
          : await fetch(urlStr, { signal: controller.signal, headers });
      } finally { clearTimeout(timeout); }

      if (!response.ok) {
        context.missing.push(`${urlStr} (HTTP ${response.status})`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > MAX_ASSET_SIZE_BYTES) {
        context.missing.push(`${urlStr} (Exceeded 10MB size limit)`);
        return null;
      }

      if (typeHint === 'animation') {
        try {
          JSON.parse(buffer.toString('utf8'));
        } catch {
          context.missing.push(`${urlStr} (Lottie response was not valid JSON)`);
          return null;
        }
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const contentType = response.headers.get('content-type') || '';

      // If duplicate content was already saved, reuse its path
      if (context.seenHashes.has(hash)) {
        const existing = context.seenHashes.get(hash)!;
        const duplicateRecord: DownloadedAsset = {
          ...existing,
          originalUrl: urlStr,
        };
        context.downloaded.push(duplicateRecord);
        return duplicateRecord;
      }

      const isFont =
        typeHint === 'font' || contentType.includes('font') || /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(urlStr);
      const isCss = typeHint === 'stylesheet' || contentType.includes('css') || /\.css(\?|#|$)/i.test(urlStr);
      const isIcon = typeHint === 'icon' || /\.ico(\?|#|$)/i.test(urlStr);

      let subfolder = 'images';
      if (typeHint === 'animation') subfolder = 'animations';
      else if (isFont) subfolder = 'fonts';
      else if (isCss) subfolder = 'css';
      else if (isIcon) subfolder = 'icons';

      const baseName =
        suggestedName ||
        this.extractFilename(urlStr, typeHint === 'animation' ? 'animation' : isFont ? 'font' : isCss ? 'stylesheet' : isIcon ? 'icon' : 'image');
      const normalizedBaseName = typeHint === 'animation' && !baseName.toLowerCase().endsWith('.json')
        ? `${baseName.replace(/\.[^.]+$/, '')}.json`
        : baseName;
      const safeFilename = `${hash}_${normalizedBaseName}`;
      const publicUrl = path.posix.join('/', context.assetRoot ?? '', subfolder, safeFilename);
      const relativeProjectFile = `public${publicUrl}`;

      await conversionStorage.writeFileSafe(conversionId, relativeProjectFile, buffer);

      const assetRecord: DownloadedAsset = {
        originalUrl: urlStr,
        localPath: relativeProjectFile,
        publicUrl,
        mimeType: contentType,
        sizeBytes: buffer.length,
        hash,
        isSvg: contentType.includes('svg') || normalizedBaseName.endsWith('.svg'),
        isFont,
        isStylesheet: isCss,
        isImage: subfolder === 'images' || subfolder === 'icons',
      };

      context.seenHashes.set(hash, assetRecord);
      context.downloaded.push(assetRecord);
      return assetRecord;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ url: urlStr, error: errorMsg }, 'Failed to download asset');
      context.missing.push(`${urlStr} (${errorMsg})`);
      return null;
    }
  }

  /**
   * Parses a CSS string for url(...) and @import declarations, downloads referenced font/image assets,
   * and rewrites relative URLs into root-relative public URLs (e.g. /fonts/...) or absolute fallback URLs.
   */
  async processAndRewriteCss(
    conversionId: string,
    rawCss: string,
    cssBaseUrl: string,
    context: {
      downloaded: DownloadedAsset[];
      missing: string[];
      seenUrls: Set<string>;
      seenHashes: Map<string, DownloadedAsset>;
      assetRoot?: 'cloned-assets';
      generatedPublicAssetUrls?: boolean;
      /** Server-resolved credentials; never included in generated files or public records. */
      proxyUrl?: string;
    }
  ): Promise<string> {
    if (!rawCss) return '';

    // Encoding directives belong to the original byte stream, not to decoded
    // UTF-8 snippets. Remove valid top-level directives before @import/media
    // wrapping; otherwise imported stylesheets acquire invalid nested @charset.
    // Leave malformed/block/nested directives for the sanitizer to reject.
    try {
      const encodingRoot = postcss.parse(rawCss.replace(/^\uFEFF/, ''));
      encodingRoot.walkAtRules(rule => {
        if (rule.name.toLowerCase() === 'charset' && rule.parent === encodingRoot && !rule.nodes && /^(['"])[^'"]+\1$/.test(rule.params.trim())) rule.remove();
      });
      rawCss = encodingRoot.toString();
    } catch { /* Existing source CSS recovery handles malformed stylesheets. */ }

    // Inline nested imports first so a successful conversion cannot retain a remote
    // stylesheet that later pulls fonts from the source host.
    const importRegex = /@import\s+(?:url\(\s*)?(['"]?)([^'"\s)]+)\1\s*\)?([^;]*);/gi;
    let rewrittenCss = '';
    let cursor = 0;
    for (const match of rawCss.matchAll(importRegex)) {
      rewrittenCss += rawCss.slice(cursor, match.index);
      cursor = (match.index || 0) + match[0].length;
      const importPath = match[2].trim();
      let absoluteImport: string;
      try {
        absoluteImport = new URL(importPath, cssBaseUrl).toString();
      } catch {
        rewrittenCss += match[0];
        continue;
      }
      const media = match[3].trim();
      const imported = await this.fetchImportedCss(absoluteImport, context);
      if (imported === null) rewrittenCss += `@import url("${absoluteImport}")${media ? ` ${media}` : ''};`;
      else {
        const nested = await this.processAndRewriteCss(conversionId, imported.css, imported.url, context);
        rewrittenCss += media ? `@media ${media} {\n${nested}\n}` : nested;
      }
    }
    rewrittenCss += rawCss.slice(cursor);

    const fontRanges: Array<[number, number]> = [];
    for (const match of rewrittenCss.matchAll(/@font-face\s*\{[\s\S]*?\}/gi)) {
      fontRanges.push([match.index || 0, (match.index || 0) + match[0].length]);
    }
    const urlRegex = cssUrlPattern();
    const replacements = new Map<string, string>();
    for (const match of rewrittenCss.matchAll(urlRegex)) {
      const rawUrl = match[1].trim();
      if (/^(?:data:|blob:|#)/i.test(unquoteCssUrl(rawUrl))) continue;
      const cleanedUrl = this.canonicalizeAssetUrl(rawUrl, context.downloaded);
      if (!cleanedUrl || /^(?:data:|blob:|#)/i.test(cleanedUrl) || replacements.has(rawUrl)) continue;

      const existingLocal = this.findDownloadedPublicUrl(cleanedUrl, context.downloaded);
      if (existingLocal) {
        replacements.set(rawUrl, existingLocal);
        continue;
      }

      // Cloned Next.js output and standalone HTML input both contain source-site
      // /images and /fonts URLs. Only downloaded records above prove they are local.
      // Preserve legacy callers' already-generated public URLs when neither mode
      // requests source downloads; assetRoot takes precedence over a true flag.
      if (!context.assetRoot && context.generatedPublicAssetUrls !== false && this.isLocalPublicAssetUrl(cleanedUrl)) {
        replacements.set(rawUrl, cleanedUrl);
        continue;
      }

      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(cleanedUrl, cssBaseUrl).toString();
      } catch {
        continue;
      }
      const inFontFace = fontRanges.some(
        ([from, to]) => (match.index || 0) >= from && (match.index || 0) < to
      );
      const nearby = rewrittenCss.slice(match.index || 0, (match.index || 0) + match[0].length + 80);
      const isFont =
        inFontFace ||
        /format\(\s*['"]?(?:woff2?|truetype|opentype|embedded-opentype)/i.test(nearby) ||
        /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(absoluteUrl);
      const isImage = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|cur)(?:[?#]|$)/i.test(absoluteUrl);
      const downloaded = await this.downloadAsset(
        conversionId,
        absoluteUrl,
        isFont ? 'font' : isImage ? 'image' : 'other',
        undefined,
        context
      );
      replacements.set(rawUrl, downloaded?.publicUrl || absoluteUrl);
    }
    return rewrittenCss.replace(urlRegex, (full, rawUrl) =>
      replacements.has(rawUrl.trim()) ? `url("${replacements.get(rawUrl.trim())}")` : full
    );
  }

  private canonicalizeAssetUrl(value: string, downloaded: DownloadedAsset[] = []): string {
    let cleaned = value
      .replace(/&quot;|&#34;|&#x22;|&apos;|&#39;|&#x27;/gi, (entity) =>
        /quot|34|22/i.test(entity) ? '"' : "'"
      )
      .trim();

    for (let pass = 0; pass < 4; pass += 1) {
      const previous = cleaned;
      cleaned = cleaned.replace(/\\(["'])/g, '$1').trim();
      try {
        cleaned = decodeURIComponent(cleaned);
      } catch {
        /* retain malformed percent escapes */
      }
      cleaned = cleaned.trim();
      while (
        cleaned.length >= 2 &&
        ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
          (cleaned.startsWith("'") && cleaned.endsWith("'")))
      ) {
        cleaned = cleaned.slice(1, -1).trim();
      }
      if (cleaned === previous) break;
    }

    // Source URLs can accidentally contain a quoted local path as their pathname,
    // e.g. https://source.test/%22/fonts/a.woff2%22.
    try {
      const parsed = new URL(cleaned);
      let pathname = parsed.pathname;
      for (let pass = 0; pass < 3; pass += 1) {
        try {
          pathname = decodeURIComponent(pathname);
        } catch {
          break;
        }
      }
      pathname = pathname.replace(/\\(["'])/g, '$1');
      while (/^\/["']/.test(pathname) && /["']$/.test(pathname)) {
        pathname = `/${pathname.slice(2, -1).replace(/^\/+/, '')}`;
      }
      const candidate = `${pathname}${parsed.search}${parsed.hash}`;
      if (candidate !== `${parsed.pathname}${parsed.search}${parsed.hash}`) {
        cleaned = `${parsed.origin}${candidate}`;
      }
      if (this.isLocalPublicAssetUrl(candidate)) {
        const matchingSource = downloaded.find((asset) => {
          try {
            const original = new URL(this.canonicalizeAssetUrl(asset.originalUrl));
            return (
              original.origin.toLowerCase() === parsed.origin.toLowerCase() &&
              `${original.pathname}${original.search}${original.hash}`.toLowerCase() ===
                candidate.toLowerCase()
            );
          } catch {
            return false;
          }
        });
        if (matchingSource) cleaned = matchingSource.publicUrl;
      }
    } catch {
      /* non-absolute URL */
    }

    return cleaned;
  }

  private isLocalPublicAssetUrl(value: string): boolean {
    return /^\/(?:cloned-assets\/)?(?:fonts|images|icons|css|animations)(?:\/|$)/i.test(value);
  }

  private normalizedAssetKey(value: string): string {
    const cleaned = this.canonicalizeAssetUrl(value);
    try {
      const parsed = new URL(cleaned, 'https://local.invalid');
      return `${parsed.origin === 'https://local.invalid' ? '' : parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
    } catch {
      return cleaned.toLowerCase();
    }
  }

  private buildDownloadedAssetMaps(downloaded: DownloadedAsset[]): {
    exact: Map<string, string>;
    uniqueFilename: Map<string, string>;
  } {
    const exact = new Map<string, string>();
    const filenameCandidates = new Map<string, Set<string>>();
    for (const asset of downloaded) {
      exact.set(this.normalizedAssetKey(asset.originalUrl), asset.publicUrl);
      exact.set(this.normalizedAssetKey(asset.publicUrl), asset.publicUrl);
      const names = [asset.originalUrl, asset.publicUrl]
        .flatMap((value) => {
          try {
            return [
              new URL(value, 'https://local.invalid').pathname
                .split('/')
                .filter(Boolean)
                .pop()
                ?.toLowerCase(),
            ];
          } catch {
            return [];
          }
        })
        .filter((name): name is string => Boolean(name));
      for (const name of names) {
        const candidates = filenameCandidates.get(name) ?? new Set<string>();
        candidates.add(asset.publicUrl);
        filenameCandidates.set(name, candidates);
      }
    }
    const uniqueFilename = new Map<string, string>();
    for (const [name, candidates] of filenameCandidates) {
      if (candidates.size === 1) uniqueFilename.set(name, [...candidates][0]);
    }
    return { exact, uniqueFilename };
  }

  private findDownloadedPublicUrl(value: string, downloaded: DownloadedAsset[]): string | undefined {
    const maps = this.buildDownloadedAssetMaps(downloaded);
    const exact = maps.exact.get(this.normalizedAssetKey(value));
    if (exact) return exact;
    let filename: string | undefined;
    try {
      filename = new URL(this.canonicalizeAssetUrl(value), 'https://local.invalid').pathname
        .split('/')
        .filter(Boolean)
        .pop()
        ?.toLowerCase();
    } catch {
      return undefined;
    }
    return filename ? maps.uniqueFilename.get(filename) : undefined;
  }

  private async fetchImportedCss(
    url: string,
    context: {
      downloaded: DownloadedAsset[];
      missing: string[];
      seenUrls: Set<string>;
      seenHashes: Map<string, DownloadedAsset>;
      assetRoot?: 'cloned-assets';
      generatedPublicAssetUrls?: boolean;
      /** Server-resolved credentials; never included in generated files or public records. */
      proxyUrl?: string;
    }
  ): Promise<{ css: string; url: string } | null> {
    if (context.seenUrls.has(url)) return { css: '', url }; // cycle/deduplication
    context.seenUrls.add(url);
    const ssrf = await validateUrlForSsrf(url);
    if (!ssrf.valid) {
      context.missing.push(`${url} (Blocked nested CSS import: ${ssrf.error})`);
      return null;
    }
    try {
      const fetched = await fetchStylesheet(url, context.proxyUrl);
      return { css: fetched.buffer.toString('utf8'), url: fetched.url };
    } catch (error) {
      context.missing.push(
        `${url} (Nested CSS import failed: ${downloadError(error)})`
      );
      return null;
    }
  }

  /**
   * Safety net that ensures no relative url(...) remains in the CSS
   */
  private localizeDownloadedAssetUrls(css: string, downloaded: DownloadedAsset[]): string {
    const maps = this.buildDownloadedAssetMaps(downloaded);
    return css.replace(cssUrlPattern(), (full, rawUrl) => {
      if (/^(?:data:|blob:|#)/i.test(unquoteCssUrl(rawUrl))) return full;
      const cleaned = this.canonicalizeAssetUrl(rawUrl, downloaded);
      if (!cleaned || /^(?:data:|blob:|#)/i.test(cleaned)) return full;
      const exact = maps.exact.get(this.normalizedAssetKey(cleaned));
      if (exact) return `url("${exact}")`;

      let filename: string | undefined;
      try {
        filename = new URL(cleaned, 'https://local.invalid').pathname
          .split('/')
          .filter(Boolean)
          .pop()
          ?.toLowerCase();
      } catch {
        return full;
      }
      const fallback = filename ? maps.uniqueFilename.get(filename) : undefined;
      return fallback ? `url("${fallback}")` : `url("${cleaned}")`;
    });
  }

  private sanitizeRemainingRelativeUrls(css: string, baseUrl: string): string {
    return css.replace(cssUrlPattern(), (match, rawUrl) => {
      if (/^(?:data:|blob:|#)/i.test(unquoteCssUrl(rawUrl))) return match;
      const cleaned = this.canonicalizeAssetUrl(rawUrl);
      if (!cleaned || /^(?:data:|blob:|#)/i.test(cleaned)) return match;
      if (this.isLocalPublicAssetUrl(cleaned) || /^https?:\/\//i.test(cleaned)) {
        return `url("${cleaned}")`;
      }
      try {
        return `url("${new URL(cleaned, baseUrl).toString()}")`;
      } catch {
        return match;
      }
    });
  }

  private extractFilename(urlStr: string, type: DiscoveredAsset['type']): string {
    try {
      const parsed = new URL(urlStr);
      let filename = parsed.pathname.split('/').filter(Boolean).pop() || `asset_${Date.now()}`;
      filename = filename.split('?')[0].split('#')[0];
      filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!filename.includes('.')) {
        if (type === 'animation') filename += '.json';
        else if (type === 'font') filename += '.woff2';
        else if (type === 'stylesheet') filename += '.css';
        else if (type === 'icon') filename += '.ico';
        else filename += '.png';
      }
      return filename;
    } catch {
      return `asset_${Date.now()}.${type === 'font' ? 'woff2' : 'png'}`;
    }
  }

  /**
   * Rewrites HTML asset references (src, srcset, background style) to use local Next.js public URLs
   */
  rewriteAssetUrlsInHtml(html: string, downloadedAssets: DownloadedAsset[], pageUrl?: string): string {
    if (!html || downloadedAssets.length === 0) return html;

    const $ = cheerio.load(html, null, false);
    const assetMap = new Map<string, string>();

    for (const item of downloadedAssets) {
      assetMap.set(item.originalUrl, item.publicUrl);
    }

    const resolveLocal = (raw: string): string | undefined => {
      if (assetMap.has(raw)) return assetMap.get(raw);
      let resolved = raw;
      if (pageUrl) {
        try {
          resolved = new URL(raw, pageUrl).toString();
        } catch {
          /* retain raw */
        }
      }
      if (assetMap.has(resolved)) return assetMap.get(resolved);
      for (const [orig, pub] of assetMap) if (orig.endsWith(raw)) return pub;
      return undefined;
    };

    $('img, source, image, use, video, audio, object, embed, input[type="image"], [data-animation-type="lottie"]').each((_, el) => {
      const node = $(el);
      for (const attribute of ['src', 'href', 'xlink:href', 'poster', 'data']) {
        const value = node.attr(attribute);
        const local = value && resolveLocal(value);
        if (local) node.attr(attribute, local);
      }

      const originalLazy = new Map(['data-src', 'data-lazy-src', 'data-original'].map(attribute => [attribute, node.attr(attribute)]));
      const lottieSrc = node.attr('data-animation-type') === 'lottie' ? node.attr('data-src') : undefined;
      const localLottie = lottieSrc && resolveLocal(lottieSrc);
      if (localLottie) node.attr('data-src', localLottie);

      const isPlaceholder = (value: string | undefined) => !value || /^(?:data:image\/(?:gif|svg\+xml);base64,|about:blank|#)/i.test(value);
      if (node.attr('data-animation-type') !== 'lottie' && isPlaceholder(node.attr('src'))) {
        for (const lazyAttribute of ['data-src', 'data-lazy-src', 'data-original']) {
          const lazy = node.attr(lazyAttribute);
          const local = lazy && resolveLocal(lazy);
          if (local) {
            node.attr('src', local);
            break;
          }
        }
      }

      for (const [attribute, raw] of originalLazy) {
        const local = raw && resolveLocal(raw);
        if (local) node.attr(attribute, local);
      }
      for (const srcsetAttribute of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
        const srcset = node.attr(srcsetAttribute);
        if (!srcset) continue;
        const rewritten = srcset
          .split(',')
          .map((part) => {
            const [url, descriptor] = part.trim().split(/\s+/);
            const local = resolveLocal(url);
            return local ? (descriptor ? `${local} ${descriptor}` : local) : part;
          })
          .join(', ');
        node.attr(srcsetAttribute, rewritten);
        if (srcsetAttribute === 'srcset' || !node.attr('srcset')) node.attr('srcset', rewritten);
      }
    });

    $('picture source').each((_, el) => {
      const node = $(el);
      if (!node.attr('srcset') && node.attr('src')) node.attr('srcset', node.attr('src')!);
    });
    $('figure').each((_, el) => {
      const figure = $(el);
      if (figure.find('img, picture, video, audio').length) return;
      const source = figure.find('source').first();
      const src = source.attr('src') || source.attr('srcset')?.trim().split(/\s+/)[0];
      if (!src) return;
      const image = $('<img>').attr('src', src).attr('alt', source.attr('alt') || '');
      if (source.attr('srcset')) image.attr('srcset', source.attr('srcset')!);
      source.after(image);
    });

    // Style attributes with url(...)
    $('[style]').each((_, el) => {
      let style = $(el).attr('style') || '';
      style = style.replace(cssUrlPattern(), (full, raw: string) => {
        const local = resolveLocal(unquoteCssUrl(raw));
        return local ? `url("${local}")` : full;
      });
      $(el).attr('style', style);
    });

    return $.html();
  }
}

export const assetDownloader = new AssetDownloader();
