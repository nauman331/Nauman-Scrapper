import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { resultRepository } from '../persistence/repositories/result.repository.js';
import { conversionStorage } from './storage.js';
import { zipPackager } from './packager/zip-packager.js';
import { exportExactHtml } from './exact-exporter.js';
import { buildPageInventory, type RawScrapePageItem } from './inventory/page-inventory.js';
import type { ExactConversionOptions, ExactConversionRecord, ExactStageId } from './exact-types.js';

const STAGES: Array<[ExactStageId, string]> = [
  ['validate-input', 'Validate Exact Export Options'], ['load-scrape-snapshot', 'Load Captured HTML'],
  ['build-page-inventory', 'Map Standalone Pages'], ['resolve-assets', 'Resolve Local Assets'],
  ['generate-html-files', 'Generate Standalone HTML'], ['preserve-source-css', 'Preserve Source CSS'],
  ['prepare-preview', 'Prepare Files and Validation'], ['package-project', 'Package Exact ZIP'],
];

export class ExactConversionService {
  private records = new Map<string, ExactConversionRecord>();
  getConversion(id: string): ExactConversionRecord | null { return this.records.get(id) || null; }
  private async loadSnapshot(jobId: string) {
    const first = await resultRepository.getResultsByJobId(jobId, { limit: 200, offset: 0 });
    const items = [...first.items];
    while (items.length < Math.min(first.total, 500)) {
      const next = await resultRepository.getResultsByJobId(jobId, { limit: Math.min(200, 500 - items.length), offset: items.length });
      if (!next.items.length) break;
      items.push(...next.items);
    }
    return { items, total: first.total };
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
  async startConversion(jobId: string, options: ExactConversionOptions): Promise<ExactConversionRecord> {
    const job = await jobRepository.getJobById(jobId);
    if (!job) throw new Error(`Job '${jobId}' was not found.`);
    const now = new Date().toISOString();
    const record: ExactConversionRecord = {
      id: `exact_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`, jobId, format: 'html', exportMode: 'exact',
      status: 'PENDING', currentStage: 'validate-input', stages: STAGES.map(([id, label]) => ({ id, label, status: 'pending' })),
      options, warnings: [], totalFilesGenerated: 0, createdAt: now, updatedAt: now,
    };
    this.records.set(record.id, record);
    setImmediate(() => { void this.run(record, job); });
    return record;
  }
  private stage(record: ExactConversionRecord, id: ExactStageId, message: string): void {
    const previous = record.stages.find((stage) => stage.id === record.currentStage);
    if (previous?.status === 'running' && previous.id !== id) { previous.status = 'completed'; previous.finishedAt = new Date().toISOString(); }
    const stage = record.stages.find((item) => item.id === id)!;
    stage.status = 'running'; stage.startedAt ||= new Date().toISOString(); stage.message = message;
    record.currentStage = id; record.updatedAt = new Date().toISOString();
  }
  private async run(record: ExactConversionRecord, job: NonNullable<Awaited<ReturnType<typeof jobRepository.getJobById>>>): Promise<void> {
    try {
      record.status = 'IN_PROGRESS';
      this.stage(record, 'validate-input', 'Exact static HTML; source CSS preserved without compilation');
      await conversionStorage.setupConversionWorkspace(record.id);
      this.stage(record, 'load-scrape-snapshot', 'Loading captured results with pagination (up to 500 pages)');
      const snapshot = await this.loadSnapshot(job.id);
      for (const id of new Set(record.options.snapshotJobIds || [])) {
        if (id === job.id) continue;
        const additionalJob = await jobRepository.getJobById(id);
        if (!additionalJob || new URL(additionalJob.targetUrl).origin !== new URL(job.targetUrl).origin) {
          throw new Error('All selected scrape snapshots must exist and belong to the same website.');
        }
        const additional = await this.loadSnapshot(id);
        snapshot.items.push(...additional.items);
        snapshot.total += additional.total;
      }
      if (snapshot.items.length > 500) throw new Error('Select at most 500 captured pages per exact project.');
      const result = await exportExactHtml({ conversionId: record.id, jobId: job.id, targetUrl: job.targetUrl, domain: job.domain,
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
        const css = await conversionStorage.readFileSafe(record.id, page.cssPath);
        if (!html || !css) { errors.push(`Missing generated HTML or CSS for ${page.url}`); continue; }
        const $ = cheerio.load(html);
        if ($('html').length !== 1 || $('head').length !== 1 || $('body').length !== 1 || $('script, iframe, object, embed, form:not([inert])').length) errors.push(`Unsafe or incomplete document: ${page.path}`);
        const references: Array<[string, string]> = [];
        $('[src], [href], [poster]').each((_, element) => {
          for (const attr of ['src', 'href', 'poster']) { const value = $(element).attr(attr); if (value) references.push([page.path, value]); }
        });
        for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) references.push([page.cssPath, match[1]]);
        const cssSources: Array<[string, string]> = [];
        $('style, [style]').each((_, element) => { cssSources.push([page.path, element.tagName === 'style' ? $(element).text() : $(element).attr('style') || '']); });
        for (const element of $('link[rel="stylesheet"][href]').toArray()) {
          const href = $(element).attr('href')!;
          if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
          const stylesheetPath = path.posix.normalize(path.posix.join(path.posix.dirname(page.path), href.split(/[?#]/)[0]));
          const stylesheet = await conversionStorage.readFileSafe(record.id, stylesheetPath);
          if (stylesheet === null) localMissing.push(`${page.path}: ${href}`);
          else cssSources.push([stylesheetPath, stylesheet]);
        }
        for (const [source, contents] of cssSources) {
          for (const match of contents.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) references.push([source, match[1]]);
        }
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
      this.stage(record, 'package-project', 'Creating static HTML and preserved CSS ZIP');
      const zip = await zipPackager.packageProject(conversionStorage.getProjectDir(record.id), conversionStorage.getZipPath(record.id, record.options.projectName));
      record.zipFilePath = zip.zipPath; record.zipSizeBytes = zip.sizeBytes;
      for (const stage of record.stages) { stage.status = 'completed'; stage.finishedAt ||= new Date().toISOString(); }
      record.status = 'COMPLETED';
    } catch (error) {
      record.status = 'FAILED'; record.errorMessage = error instanceof Error ? error.message : String(error);
      const stage = record.stages.find((item) => item.id === record.currentStage)!;
      stage.status = 'failed'; stage.message = record.errorMessage; stage.finishedAt = new Date().toISOString();
    } finally { record.finishedAt = new Date().toISOString(); record.updatedAt = record.finishedAt; }
  }
}
export const exactConversionService = new ExactConversionService();
