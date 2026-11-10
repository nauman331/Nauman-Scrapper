import crypto from 'node:crypto';
import { logger } from '../monitoring/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { loadBoundedSnapshot, type SnapshotBudget } from './snapshot-loader.js';
import { conversionStorage } from './storage.js';
import { zipPackager } from './packager/zip-packager.js';
import { exportStandaloneHtml, TAILWIND_BROWSER_URL, TAILWIND_BROWSER_CONFIG } from './html-exporter.js';
import { buildPageInventory, type RawScrapePageItem } from './inventory/page-inventory.js';
import type { HtmlConversionOptions, HtmlConversionRecord, HtmlStageId } from './html-types.js';
import { proxyService } from '../proxies/proxy.service.js';

const STAGES: Array<[HtmlStageId, string]> = [
  ['validate-input', 'Validate HTML Export Options'], ['load-scrape-snapshot', 'Load Captured HTML'],
  ['build-page-inventory', 'Map Standalone Pages'], ['resolve-assets', 'Resolve Local Assets'],
  ['generate-html-files', 'Generate Standalone HTML'], ['compile-tailwind', 'Prepare Tailwind CDN and Preview'],
  ['prepare-preview', 'Prepare Files and Validation'], ['package-project', 'Package HTML ZIP'],
];

export class HtmlConversionService {
  private records = new Map<string, HtmlConversionRecord>();
  getConversion(id: string): HtmlConversionRecord | null { return this.records.get(id) || null; }
  private async loadSnapshot(jobId: string, urls?: string[], budget?: SnapshotBudget) {
    return loadBoundedSnapshot(jobId, urls, budget);
  }
  async getJobPreview(jobId: string) {
    const job = await jobRepository.getJobById(jobId);
    if (!job) throw new Error(`Job '${jobId}' was not found.`);
    const snapshot = await this.loadSnapshot(jobId);
    return buildPageInventory(jobId, job.targetUrl, job.domain, snapshot.items.map((page) => ({
      url: page.url, rawData: page.rawData as RawScrapePageItem['rawData'], normalizedData: page.normalizedData as RawScrapePageItem['normalizedData'],
    })).filter((page) => new URL(page.url).origin === new URL(job.targetUrl).origin));
  }
  async getGeneratedFile(id: string, filePath: string): Promise<string | null> { return conversionStorage.readFileSafe(id, filePath); }
  async getPreviewCss(id: string, filePath: string): Promise<string | null> {
    // Generated metadata lives outside project/, so it never enters downloads.
    // Both ID and page path remain constrained to conversion storage/inventory.
    if (!this.records.get(id)?.pageFiles?.some(page => page.path === filePath)) return null;
    try {
      const data: Record<string, string> = JSON.parse(await fs.readFile(path.join(conversionStorage.getConversionDir(id), 'tailwind-preview.json'), 'utf8'));
      return data[filePath] ?? null;
    } catch { return null; }
  }
  async startConversion(jobId: string, options: HtmlConversionOptions): Promise<HtmlConversionRecord> {
    const job = await jobRepository.getJobById(jobId);
    if (!job) throw new Error(`Job '${jobId}' was not found.`);
    if (options.useProxy) {
      if (!options.proxyId) throw Object.assign(new Error('Select a saved proxy when proxy routing is enabled.'), { statusCode: 400 });
      await proxyService.assertExists(options.proxyId);
    }
    const now = new Date().toISOString();
    const record: HtmlConversionRecord = {
      id: `html_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`, jobId, format: 'html',
      status: 'PENDING', currentStage: 'validate-input', stages: STAGES.filter(([id]) => options.cssStrategy !== 'core' || id !== 'compile-tailwind').map(([id, label]) => ({ id, label, status: 'pending' })),
      options, warnings: [], totalFilesGenerated: 0, createdAt: now, updatedAt: now,
    };
    this.records.set(record.id, record);
    // Delay work until the caller receives its stable accepted response.
    setImmediate(() => { void this.run(record, job); });
    return record;
  }
  private stage(record: HtmlConversionRecord, id: HtmlStageId, message: string): void {
    const previous = record.stages.find((stage) => stage.id === record.currentStage);
    if (previous?.status === 'running' && previous.id !== id) { previous.status = 'completed'; previous.finishedAt = new Date().toISOString(); }
    const stage = record.stages.find((item) => item.id === id)!;
    stage.status = 'running'; stage.startedAt ||= new Date().toISOString(); stage.message = message;
    record.currentStage = id; record.updatedAt = new Date().toISOString();
  }
  private async run(record: HtmlConversionRecord, job: NonNullable<Awaited<ReturnType<typeof jobRepository.getJobById>>>): Promise<void> {
    try {
      record.status = 'IN_PROGRESS';
      this.stage(record, 'validate-input', record.options.cssStrategy === 'core' ? 'Standalone HTML with external Core CSS; no compilation required' : 'Standalone HTML with Tailwind CDN; private script-free preview enabled');
      await conversionStorage.setupConversionWorkspace(record.id);
      this.stage(record, 'load-scrape-snapshot', 'Loading captured results with pagination (up to 500 pages)');
      // Only snapshot orchestration changes: every page was captured by the
      // existing single-page crawler and goes through the unchanged exporter.
      const budget: SnapshotBudget = { pages: 0, bytes: 0 };
      const snapshot = await this.loadSnapshot(job.id, record.options.pages, budget);
      for (const id of new Set(record.options.snapshotJobIds || [])) {
        if (id === job.id) continue;
        const additionalJob = await jobRepository.getJobById(id);
        if (!additionalJob || new URL(additionalJob.targetUrl).origin !== new URL(job.targetUrl).origin) {
          throw new Error('All selected scrape snapshots must exist and belong to the same website.');
        }
        const additional = await this.loadSnapshot(id, record.options.pages, budget);
        snapshot.items.push(...additional.items);
        snapshot.total += additional.total;
      }
      if (snapshot.items.length > 500) throw new Error('Select at most 500 captured pages per HTML project.');
      const result = await exportStandaloneHtml({ conversionId: record.id, jobId: job.id, targetUrl: job.targetUrl, domain: job.domain,
        pages: snapshot.items.map((page) => ({ url: page.url, rawData: page.rawData as RawScrapePageItem['rawData'], normalizedData: page.normalizedData as RawScrapePageItem['normalizedData'] })), options: record.options,
        stage: (id, message) => this.stage(record, id, message),
      });
      Object.assign(record, { inventory: result.inventory, pageFiles: result.pageFiles, conversionStats: result.conversionStats, svgStats: result.svgStats, warnings: result.warnings, totalFilesGenerated: result.totalFilesGenerated });
      if (snapshot.total > snapshot.items.length) record.warnings.push(`Snapshot bounded to the first ${snapshot.items.length} of ${snapshot.total} captured results.`);
      this.stage(record, 'prepare-preview', 'Preparing generated files and static export report');
      record.fileTree = await conversionStorage.buildFileTree(record.id);
      const errors: string[] = [];
      const localMissing: string[] = [];
      const root = conversionStorage.getProjectDir(record.id);
      for (const page of result.pageFiles) {
        const html = await conversionStorage.readFileSafe(record.id, page.path);
        const isCore = record.options.cssStrategy === 'core';
        const css = isCore ? await conversionStorage.readFileSafe(record.id, page.cssPath) : '';
        if (!html || (isCore && !css)) { errors.push(`Missing generated HTML or CSS for ${page.url}`); continue; }
        const $ = cheerio.load(html);
        const unsafeScripts = $('script').toArray().filter(element => isCore || !(
          ($(element).attr('src') === TAILWIND_BROWSER_URL && !$(element).text().trim()) ||
          (!$(element).attr('src') && $(element).text().trim() === TAILWIND_BROWSER_CONFIG)
        ));
        if ($('html').length !== 1 || $('head').length !== 1 || $('body').length !== 1 || unsafeScripts.length || $('iframe, object, embed, form:not([inert])').length) errors.push(`Unsafe or incomplete document: ${page.path}`);
        if (!isCore && ($('[style], style, link[rel~="stylesheet"]:not([data-cloned-fonts])').length || $('script[src]').length !== 1 || $('script[src]').attr('src') !== TAILWIND_BROWSER_URL)) errors.push(`Invalid Tailwind CDN document: ${page.path}`);
        if (record.options.cssStrategy === 'core') {
          if ($('[style], style').length) errors.push(`Inline CSS remains in Core CSS document: ${page.path}`);
          if (!css!.startsWith('/* it is converted from inline CSS to external CSS */')) errors.push(`Missing Core CSS conversion comment: ${page.cssPath}`);
        }
        const references: Array<[string, string]> = [];
        $('[src], [href], [poster]').each((_, element) => {
          for (const attr of ['src', 'href', 'poster']) { const value = $(element).attr(attr); if (value) references.push([page.path, value]); }
        });
        const assetCss = isCore ? css || '' : await this.getPreviewCss(record.id, page.path) || '';
        for (const match of assetCss.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) references.push([isCore ? page.cssPath : page.path, match[1]]);
        for (const [source, reference] of references) {
          if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
          const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source), reference.split(/[?#]/)[0]));
          if (relative.startsWith('../') || path.posix.isAbsolute(relative)) { errors.push(`Unsafe local reference: ${reference}`); continue; }
          try { await fs.access(path.join(root, relative)); } catch { localMissing.push(`${source}: ${reference}`); }
        }
      }
      if (localMissing.length) record.warnings.push(...localMissing.map((reference) => `Unresolved generated local asset/link: ${reference}`));
      record.validationReport = { passed: errors.length === 0, requiredFilesExist: errors.length === 0, syntaxValid: errors.length === 0, importReferencesValid: true,
        assetReferencesValid: result.missingAssets.length === 0 && localMissing.length === 0, errors, warnings: record.warnings,
        checkedFilesCount: record.totalFilesGenerated, missingAssets: [...result.missingAssets, ...localMissing], brokenInternalRoutes: localMissing,
      };
      if (errors.length) throw new Error(errors.join('; '));
      this.stage(record, 'package-project', record.options.cssStrategy === 'core' ? 'Creating self-contained HTML and external Core CSS ZIP' : 'Creating HTML and assets ZIP with Tailwind CDN');
      const zip = await zipPackager.packageProject(conversionStorage.getProjectDir(record.id), conversionStorage.getZipPath(record.id, record.options.projectName));
      record.zipFilePath = zip.zipPath; record.zipSizeBytes = zip.sizeBytes;
      for (const stage of record.stages) { stage.status = 'completed'; stage.finishedAt ||= new Date().toISOString(); }
      record.status = 'COMPLETED';
    } catch (error) {
      logger.error({ conversionId: record.id, jobId: record.jobId, stage: record.currentStage,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      }, 'HTML conversion failed');
      record.status = 'FAILED'; record.errorMessage = error instanceof Error ? error.message : String(error);
      const stage = record.stages.find((item) => item.id === record.currentStage)!;
      stage.status = 'failed'; stage.message = record.errorMessage; stage.finishedAt = new Date().toISOString();
    } finally { record.finishedAt = new Date().toISOString(); record.updatedAt = record.finishedAt; }
  }
}
export const htmlConversionService = new HtmlConversionService();
