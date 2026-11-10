import crypto from 'node:crypto';
import path from 'node:path';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import { validateUrlForSsrf } from '../../core/ssrf/ssrf-validator.js';
import { conversionStorage } from '../storage.js';
import type { DiscoveredAsset } from './asset-collector.js';
import type { DownloadedAsset } from '../types.js';
import { logger } from '../../monitoring/logger.js';
import { cssDataUrl, cssUrlPattern, unquoteCssUrl } from './css-urls.js';
import { fetchThroughProxy } from '../../proxies/proxy-fetch.js';

const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024; // 10MB for ordinary assets
const MAX_VIDEO_SIZE_BYTES = 512 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;
const VIDEO_FETCH_TIMEOUT_MS = 120000;
const VIDEO_URL_PATTERN = /\.(?:mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface AssetDownloadLimits {
  maxConcurrent: number;
  maxPerHost: number;
  maxVideos: number;
}
const DEFAULT_DOWNLOAD_LIMITS: AssetDownloadLimits = { maxConcurrent: 4, maxPerHost: 2, maxVideos: 1 };

/** Only network transfers hold permits: recursive CSS/optimizer work cannot deadlock the pool. */
class AssetTransferScheduler {
  private active = 0;
  private videos = 0;
  private readonly hosts = new Map<string, number>();
  private readonly queue: Array<{ host: string; video: boolean; resolve: (release: () => void) => void }> = [];

  constructor(private readonly limits: AssetDownloadLimits) {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid downloadLimits.${name}: expected a positive safe integer`);
    }
  }

  acquire(url: string, video: boolean): Promise<() => void> {
    const host = new URL(url).hostname.toLowerCase();
    return new Promise(resolve => {
      this.queue.push({ host, video, resolve });
      this.drain();
    });
  }

  private drain(): void {
    for (let index = 0; index < this.queue.length && this.active < this.limits.maxConcurrent;) {
      const task = this.queue[index];
      if ((this.hosts.get(task.host) ?? 0) >= this.limits.maxPerHost || (task.video && this.videos >= this.limits.maxVideos)) {
        index++;
        continue;
      }
      this.queue.splice(index, 1);
      this.active++;
      this.hosts.set(task.host, (this.hosts.get(task.host) ?? 0) + 1);
      if (task.video) this.videos++;
      task.resolve(() => {
        this.active--;
        this.hosts.set(task.host, this.hosts.get(task.host)! - 1);
        if (task.video) this.videos--;
        this.drain();
      });
    }
  }
}

/** Bound task creation as well as transfers, so pending writes do not accumulate buffers. */
async function forEachConcurrent<T>(items: T[], concurrency: number, visit: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (!failed && cursor < items.length) {
      const item = items[cursor++];
      try { await visit(item); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  // Drain running tasks before propagating fatal errors; no writes outlive resolution.
  if (failed) throw failure;
}

function downloadError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return [error.message, cause?.code, cause?.message].filter(Boolean).join(': ');
}

/** Bounded retries; redirects are manually validated so retries never bypass SSRF. */
async function fetchAssetBytes(
  url: string,
  proxyUrl?: string,
  options: { maxBytes: number; timeoutMs: number; expectedType?: 'CSS' | 'video'; sizeError?: () => Error } = {
    maxBytes: MAX_ASSET_SIZE_BYTES, timeoutMs: FETCH_TIMEOUT_MS, expectedType: 'CSS',
  },
  scheduler?: AssetTransferScheduler
): Promise<{ buffer: Buffer; url: string; contentType: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      let target = url;
      for (let redirects = 0; redirects <= 5; redirects++) {
        const ssrf = await validateUrlForSsrf(target);
        if (!ssrf.valid) throw Object.assign(new Error(`Blocked ${options.expectedType === 'CSS' ? 'stylesheet' : 'asset'} URL: ${ssrf.error || 'SSRF policy'}`), { permanent: true });
        const release = await scheduler?.acquire(target, options.expectedType === 'video');
        timeout ??= setTimeout(() => controller.abort(), options.timeoutMs);
        try {
          const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', Accept: options.expectedType === 'CSS' ? 'text/css,*/*;q=0.1' : '*/*' };
          const response = proxyUrl
            ? await fetchThroughProxy(target, proxyUrl, { signal: controller.signal, headers, maxBytes: options.maxBytes })
            : await fetch(target, { signal: controller.signal, redirect: 'manual', headers });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location || redirects === 5) throw Object.assign(new Error('Invalid asset redirect or redirect limit exceeded'), { permanent: true });
            target = new URL(location, target).href;
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw Object.assign(new Error(`HTTP ${response.status}`), { permanent: !RETRYABLE_STATUSES.has(response.status) });
          }
          const contentType = response.headers.get('content-type') || '';
          if (options.expectedType && /text\/html|application\/xhtml/i.test(contentType)) {
            await response.body?.cancel();
            throw Object.assign(new Error(`Expected ${options.expectedType} but received HTML (possible access challenge)`), { permanent: true });
          }
          const sizeError = () => Object.assign(options.sizeError?.() ?? new Error(`Exceeded ${options.maxBytes / (1024 * 1024)}MB size limit`), { permanent: true });
          if (Number(response.headers.get('content-length')) > options.maxBytes) {
            await response.body?.cancel();
            throw sizeError();
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
                if (size > options.maxBytes) {
                  await reader.cancel();
                  throw sizeError();
                }
                chunks.push(Buffer.from(value));
              }
            } catch (error) {
              await reader.cancel().catch(() => {});
              throw error;
            } finally { reader.releaseLock(); }
          }
          if (size === 0 && options.expectedType !== 'CSS') throw new Error('Empty asset response');
          return { buffer: Buffer.concat(chunks, size), url: target, contentType };
        } finally {
          clearTimeout(timeout);
          timeout = undefined;
          release?.();
        }
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

export interface CssProcessingLimits {
  maxImportCount: number;
  maxImportDepth: number;
  /** Cumulative UTF-8 source bytes across all inline/downloaded/imported sheets. */
  maxInputBytes: number;
  /** Cumulative generated bytes, including recursive copies and consolidation passes. */
  maxOutputBytes: number;
}
const DEFAULT_CSS_LIMITS: CssProcessingLimits = {
  maxImportCount: 256,
  maxImportDepth: 32,
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 64 * 1024 * 1024,
};
interface CssBudget {
  limits: CssProcessingLimits;
  imports: number;
  inputBytes: number;
  outputBytes: number;
}
export class CssBudgetExceededError extends Error {
  constructor(limit: keyof CssProcessingLimits, maximum: number, source: string) {
    super(`CSS processing budget exceeded: ${limit}=${maximum} at ${source}. Reduce stylesheet/import size or raise AssetResolutionOptions.cssLimits.${limit} for trusted sources.`);
    this.name = 'CssBudgetExceededError';
  }
}

export interface AssetResolutionOptions {
  /** Shared by HTML assets, CSS dependencies, retries and redirect destinations. */
  downloadLimits?: Partial<AssetDownloadLimits>;
  /** Per-conversion bounds; overrides also enable deterministic small-budget tests. */
  cssLimits?: Partial<CssProcessingLimits>;
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

interface DownloadContext {
  downloaded: DownloadedAsset[];
  missing: string[];
  seenUrls: Set<string>;
  seenHashes: Map<string, DownloadedAsset>;
  assetRoot?: 'cloned-assets';
  generatedPublicAssetUrls?: boolean;
  proxyUrl?: string;
  cssLimits?: Partial<CssProcessingLimits>;
  downloadLimits?: Partial<AssetDownloadLimits>;
}

export class AssetDownloader {
  private readonly transfers = new WeakMap<object, {
    scheduler: AssetTransferScheduler;
    limits: AssetDownloadLimits;
    urls: Map<string, Promise<DownloadedAsset | null>>;
    hashes: Map<string, Promise<DownloadedAsset>>;
  }>();

  private transferState(context: { downloadLimits?: Partial<AssetDownloadLimits> }) {
    let state = this.transfers.get(context);
    if (!state) {
      const limits = { ...DEFAULT_DOWNLOAD_LIMITS, ...context.downloadLimits };
      state = { scheduler: new AssetTransferScheduler(limits), limits, urls: new Map(), hashes: new Map() };
      this.transfers.set(context, state);
    }
    return state;
  }

  private readonly cssBudgets = new WeakMap<object, CssBudget>();
  private readonly downloadedMaps = new WeakMap<DownloadedAsset[], { count: number; exact: Map<string, string>; uniqueFilename: Map<string, string>; filenames: Map<string, Set<string>> }>();

  private cssBudget(context: { cssLimits?: Partial<CssProcessingLimits> }): CssBudget {
    const existing = this.cssBudgets.get(context);
    if (existing) return existing;
    const limits = { ...DEFAULT_CSS_LIMITS, ...context.cssLimits };
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid cssLimits.${name}: expected a nonnegative safe integer`);
    }
    const budget = { limits, imports: 0, inputBytes: 0, outputBytes: 0 };
    this.cssBudgets.set(context, budget);
    return budget;
  }

  private fetchCss(url: string, context: { proxyUrl?: string; cssLimits?: Partial<CssProcessingLimits>; downloadLimits?: Partial<AssetDownloadLimits> }): ReturnType<typeof fetchAssetBytes> {
    const budget = this.cssBudget(context);
    const remaining = budget.limits.maxInputBytes - budget.inputBytes;
    return fetchAssetBytes(url, context.proxyUrl, {
      maxBytes: Math.min(MAX_ASSET_SIZE_BYTES, remaining), timeoutMs: FETCH_TIMEOUT_MS, expectedType: 'CSS',
      sizeError: remaining <= MAX_ASSET_SIZE_BYTES
        ? () => new CssBudgetExceededError('maxInputBytes', budget.limits.maxInputBytes, url)
        : undefined,
    }, this.transferState(context).scheduler);
  }

  private chargeCss(budget: CssBudget, kind: 'inputBytes' | 'outputBytes', bytes: number, source: string): void {
    const limit = kind === 'inputBytes' ? 'maxInputBytes' : 'maxOutputBytes';
    if (bytes > budget.limits[limit] - budget[kind]) throw new CssBudgetExceededError(limit, budget.limits[limit], source);
    budget[kind] += bytes;
  }
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
      cssLimits: options.cssLimits,
      downloadLimits: options.downloadLimits,
    };
    const budget = this.cssBudget(context);

    // 1. Download independent HTML assets in a bounded pool. CSS stays in cascade order.
    const { limits } = this.transferState(context);
    await forEachConcurrent(discoveredAssets.filter(asset => asset.type !== 'stylesheet'), limits.maxConcurrent, async asset => {
      await this.downloadAsset(conversionId, asset.originalUrl, asset.type, asset.suggestedLocalName, context);
    });
    if (!options.cssSources) {
      for (const asset of discoveredAssets.filter(asset => asset.type === 'stylesheet')) {
        await this.downloadAndProcessStylesheet(conversionId, asset, cssSnippets, context);
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
    const separator = '\n\n/* --- Next Section Stylesheet --- */\n\n';
    this.chargeCss(budget, 'outputBytes', cssSnippets.reduce((bytes, css) => bytes + Buffer.byteLength(css, 'utf8'), 0) + Math.max(0, cssSnippets.length - 1) * Buffer.byteLength(separator), 'consolidated CSS');
    let consolidatedCss = cssSnippets.join(separator);

    // 4. Ensure any remaining url(...) in consolidated CSS matching downloaded originalUrls are rewritten
    for (const item of downloaded) {
      if (item.isImage || item.isFont) {
        const escaped = item.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        consolidatedCss = consolidatedCss.replace(new RegExp(escaped, 'g'), item.publicUrl);
      }
    }

    this.chargeCss(budget, 'outputBytes', Buffer.byteLength(consolidatedCss, 'utf8'), 'downloaded URL consolidation');

    // Prefer matching downloaded assets over malformed encoded remote URLs.
    consolidatedCss = this.localizeDownloadedAssetUrls(consolidatedCss, downloaded);
    this.chargeCss(budget, 'outputBytes', Buffer.byteLength(consolidatedCss, 'utf8'), 'localized CSS');

    // 5. Final safety net: Convert ANY remaining relative url(...) to absolute so Webpack never crashes
    const defaultBaseUrl = discoveredAssets[0]?.sourcePageUrl || 'https://localhost';
    consolidatedCss = this.sanitizeRemainingRelativeUrls(consolidatedCss, defaultBaseUrl);
    this.chargeCss(budget, 'outputBytes', Buffer.byteLength(consolidatedCss, 'utf8'), 'final CSS');

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
      cssLimits?: Partial<CssProcessingLimits>;
      downloadLimits?: Partial<AssetDownloadLimits>;
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
      const fetched = await this.fetchCss(asset.originalUrl, context);
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
      if (err instanceof CssBudgetExceededError) throw err;
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
    context: DownloadContext
  ): Promise<DownloadedAsset | null> {
    const state = this.transferState(context);
    const existing = state.urls.get(urlStr);
    if (existing) return existing;
    // Defer execution until the promise is registered, including optimizer recursion.
    const pending = Promise.resolve().then(() => this.downloadAssetOnce(conversionId, urlStr, typeHint, suggestedName, context));
    state.urls.set(urlStr, pending);
    return pending;
  }

  private async downloadAssetOnce(
    conversionId: string,
    urlStr: string,
    typeHint: DiscoveredAsset['type'],
    suggestedName: string | undefined,
    context: DownloadContext
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
      const videoHint = typeHint === 'video' || VIDEO_URL_PATTERN.test(urlStr);
      const { buffer, contentType } = await fetchAssetBytes(urlStr, context.proxyUrl, {
        maxBytes: videoHint ? MAX_VIDEO_SIZE_BYTES : MAX_ASSET_SIZE_BYTES,
        timeoutMs: videoHint ? VIDEO_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS,
        expectedType: videoHint ? 'video' : undefined,
      }, this.transferState(context).scheduler);

      if (typeHint === 'animation') {
        try {
          JSON.parse(buffer.toString('utf8'));
        } catch {
          context.missing.push(`${urlStr} (Lottie response was not valid JSON)`);
          return null;
        }
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);

      // Share pending writes as well as completed files for identical content.
      const state = this.transferState(context);
      const pendingWrite = state.hashes.get(hash);
      const existingHash = context.seenHashes.get(hash) ?? (pendingWrite ? await pendingWrite : undefined);
      if (existingHash) {
        const existing = existingHash;
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

      const isVideo = videoHint || /^video\//i.test(contentType);
      let subfolder = 'images';
      // Keep the established asset folders: standalone export validates these paths.
      if (typeHint === 'animation') subfolder = 'animations';
      else if (isFont) subfolder = 'fonts';
      else if (isCss) subfolder = 'css';
      else if (isIcon) subfolder = 'icons';

      const baseName =
        suggestedName ||
        this.extractFilename(urlStr, isVideo ? 'video' : typeHint === 'animation' ? 'animation' : isFont ? 'font' : isCss ? 'stylesheet' : isIcon ? 'icon' : 'image');
      const normalizedBaseName = typeHint === 'animation' && !baseName.toLowerCase().endsWith('.json')
        ? `${baseName.replace(/\.[^.]+$/, '')}.json`
        : isVideo && !baseName.includes('.')
          ? `${baseName}.${/video\/webm/i.test(contentType) ? 'webm' : /video\/ogg/i.test(contentType) ? 'ogv' : 'mp4'}`
          : baseName;
      const safeFilename = `${hash}_${normalizedBaseName}`;
      const publicUrl = path.posix.join('/', context.assetRoot ?? '', subfolder, safeFilename);
      const relativeProjectFile = `public${publicUrl}`;

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
        isImage: !isVideo && (subfolder === 'images' || subfolder === 'icons'),
      };

      const write = Promise.resolve().then(async () => {
        await conversionStorage.writeFileSafe(conversionId, relativeProjectFile, buffer);
        context.seenHashes.set(hash, assetRecord);
        return assetRecord;
      });
      state.hashes.set(hash, write);
      try { await write; }
      finally { state.hashes.delete(hash); }
      context.downloaded.push(assetRecord);
      return assetRecord;
    } catch (err: unknown) {
      if (err instanceof CssBudgetExceededError) throw err;
      const errorMsg = downloadError(err);
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
      cssLimits?: Partial<CssProcessingLimits>;
      downloadLimits?: Partial<AssetDownloadLimits>;
    },
    importDepth = 0
  ): Promise<string> {
    if (!rawCss) return '';
    const budget = this.cssBudget(context);
    this.chargeCss(budget, 'inputBytes', Buffer.byteLength(rawCss, 'utf8'), cssBaseUrl);
    // Normalize malformed data wrappers before parsing or resolving URLs. Valid
    // data URLs remain byte-for-byte intact (including encoded SVG payloads).
    rawCss = rawCss.replace(cssUrlPattern(), (full, raw: string) => {
      const cleaned = unquoteCssUrl(raw);
      return /^data:/i.test(cleaned) && !/^(?:"data:|'data:|data:)/i.test(raw.trim()) ? cssDataUrl(cleaned) : full;
    });

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
    const append = (css: string) => {
      this.chargeCss(budget, 'outputBytes', Buffer.byteLength(css, 'utf8'), cssBaseUrl);
      rewrittenCss += css;
    };
    let cursor = 0;
    for (const match of rawCss.matchAll(importRegex)) {
      if (++budget.imports > budget.limits.maxImportCount) throw new CssBudgetExceededError('maxImportCount', budget.limits.maxImportCount, cssBaseUrl);
      if (importDepth >= budget.limits.maxImportDepth) throw new CssBudgetExceededError('maxImportDepth', budget.limits.maxImportDepth, cssBaseUrl);
      append(rawCss.slice(cursor, match.index));
      cursor = (match.index || 0) + match[0].length;
      const importPath = match[2].trim();
      let absoluteImport: string;
      try {
        absoluteImport = new URL(importPath, cssBaseUrl).toString();
      } catch {
        append(match[0]);
        continue;
      }
      const media = match[3].trim();
      const imported = await this.fetchImportedCss(absoluteImport, context);
      if (imported === null) append(`@import url("${absoluteImport}")${media ? ` ${media}` : ''};`);
      else {
        const nested = await this.processAndRewriteCss(conversionId, imported.css, imported.url, context, importDepth + 1);
        append(media ? `@media ${media} {\n${nested}\n}` : nested);
      }
    }
    append(rawCss.slice(cursor));

    const fontRanges: Array<[number, number]> = [];
    for (const match of rewrittenCss.matchAll(/@font-face\s*\{[\s\S]*?\}/gi)) {
      fontRanges.push([match.index || 0, (match.index || 0) + match[0].length]);
    }
    const urlRegex = cssUrlPattern();
    const replacements = new Map<string, string>();
    const dependencies: Array<{ rawUrl: string; absoluteUrl: string; type: DiscoveredAsset['type'] }> = [];
    const queuedUrls = new Set<string>();
    for (const match of rewrittenCss.matchAll(urlRegex)) {
      const rawUrl = match[1].trim();
      if (/^(?:data:|blob:|#)/i.test(unquoteCssUrl(rawUrl))) continue;
      const cleanedUrl = this.canonicalizeAssetUrl(rawUrl, context.downloaded);
      if (!cleanedUrl || /^(?:data:|blob:|#)/i.test(cleanedUrl) || replacements.has(rawUrl) || queuedUrls.has(rawUrl)) continue;

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
      queuedUrls.add(rawUrl);
      dependencies.push({ rawUrl, absoluteUrl, type: isFont ? 'font' : isImage ? 'image' : 'other' });
    }
    await forEachConcurrent(dependencies, this.transferState(context).limits.maxConcurrent, async dependency => {
      const downloaded = await this.downloadAsset(conversionId, dependency.absoluteUrl, dependency.type, undefined, context);
      replacements.set(dependency.rawUrl, downloaded?.publicUrl || dependency.absoluteUrl);
    });
    // Charge rewritten output before allocating it; long fallback/public URLs
    // can grow CSS substantially even when the source input was small.
    let urlBytes = 0;
    for (const match of rewrittenCss.matchAll(urlRegex)) {
      const replacement = replacements.has(match[1].trim()) ? `url("${replacements.get(match[1].trim())}")` : match[0];
      urlBytes += Buffer.byteLength(match[0], 'utf8');
      this.chargeCss(budget, 'outputBytes', Buffer.byteLength(replacement, 'utf8'), cssBaseUrl);
    }
    // Non-URL text is copied by String.replace too.
    this.chargeCss(budget, 'outputBytes', Buffer.byteLength(rewrittenCss, 'utf8') - urlBytes, cssBaseUrl);
    return rewrittenCss.replace(urlRegex, (full, rawUrl) =>
      replacements.has(rawUrl.trim()) ? `url("${replacements.get(rawUrl.trim())}")` : full
    );
  }

  private canonicalizeAssetUrl(value: string, downloaded: DownloadedAsset[] = []): string {
    value = unquoteCssUrl(value);
    if (/^(?:data:|blob:|#)/i.test(value)) return value;
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
        const matchingSource = downloaded.length
          ? this.buildDownloadedAssetMaps(downloaded).exact.get(this.normalizedAssetKey(`${parsed.origin}${candidate}`))
          : undefined;
        if (matchingSource) cleaned = matchingSource;
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
    let cached = this.downloadedMaps.get(downloaded);
    if (!cached || cached.count > downloaded.length) {
      cached = { count: 0, exact: new Map(), uniqueFilename: new Map(), filenames: new Map() };
      this.downloadedMaps.set(downloaded, cached);
    }
    const { exact, uniqueFilename, filenames: filenameCandidates } = cached;
    for (let index = cached.count; index < downloaded.length; index++) {
      const asset = downloaded[index];
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
        if (candidates.size === 1) uniqueFilename.set(name, asset.publicUrl);
        else uniqueFilename.delete(name);
      }
    }
    cached.count = downloaded.length;
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
      cssLimits?: Partial<CssProcessingLimits>;
      downloadLimits?: Partial<AssetDownloadLimits>;
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
      const fetched = await this.fetchCss(url, context);
      return { css: fetched.buffer.toString('utf8'), url: fetched.url };
    } catch (error) {
      if (error instanceof CssBudgetExceededError) throw error;
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
      const unquoted = unquoteCssUrl(rawUrl);
      if (/^(?:data:|blob:|#)/i.test(unquoted)) return /^data:/i.test(unquoted) && !/^(?:"data:|'data:|data:)/i.test(rawUrl.trim()) ? cssDataUrl(unquoted) : full;
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
      const unquoted = unquoteCssUrl(rawUrl);
      if (/^(?:data:|blob:|#)/i.test(unquoted)) return /^data:/i.test(unquoted) && !/^(?:"data:|'data:|data:)/i.test(rawUrl.trim()) ? cssDataUrl(unquoted) : match;
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
        else if (type !== 'video') filename += '.png';
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
