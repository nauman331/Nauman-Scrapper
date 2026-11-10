import crypto from 'node:crypto';
import { jobRepository } from '../persistence/repositories/job.repository.js';
import { loadBoundedSnapshot } from './snapshot-loader.js';
import { removeSnapshotLoaders } from './loader-cleanup.js';
import { applyVideoPolicy } from './video-policy.js';
import { conversionStorage } from './storage.js';
import { buildPageInventory, type RawScrapePageItem } from './inventory/page-inventory.js';
import { domAnalyzer } from './analyzer/dom-analyzer.js';
import { deriveSiteBodyContext, removeCommonBodyClasses } from './analyzer/body-context.js';
import { convertDocumentsToTailwind } from './analyzer/tailwind-converter.js';
import { rewriteBodyContextSelectors, sanitizeGeneratedCss } from './css-sanitizer.js';
import { componentDetector, type PageStructureMap } from './analyzer/component-detector.js';
import { assetCollector, type DiscoveredAsset } from './assets/asset-collector.js';
import { assetDownloader } from './assets/asset-downloader.js';
import {
  generatePackageJson,
  generateTsConfig,
  generateNextConfig,
  generateSiteConfig,
  generateUtils,
  generateReadme,
  generateTailwindConfig,
  generatePostCssConfig,
  generateLottieAssetComponent,
} from './codegen/project-template.js';
import { generateRootLayout } from './codegen/layout-generator.js';
import { generatePageRoute } from './codegen/page-generator.js';
import type { GeneratedSvgAsset } from './codegen/jsx-transformer.js';
import { staticValidator } from './validator/static-validator.js';
import { compileGeneratedCss } from './validator/css-compiler.js';
import { zipPackager } from './packager/zip-packager.js';
import { logger } from '../monitoring/logger.js';
import type {
  ConversionOptions,
  ConversionRecord,
  ConversionStageId,
  StageProgress,
  PageInventory,
} from './types.js';

const STAGES: Array<{ id: ConversionStageId; label: string }> = [
  { id: 'validate-input', label: 'Validate Input & Configuration' },
  { id: 'load-scrape-snapshot', label: 'Load Scraped Pages & HTML' },
  { id: 'build-page-inventory', label: 'Build Page & Route Inventory' },
  { id: 'resolve-assets', label: 'Download & Resolve Assets' },
  { id: 'analyze-page-structure', label: 'Analyze DOM & Layout Structure' },
  { id: 'identify-shared-components', label: 'Identify Shared Layout & Components' },
  { id: 'generate-nextjs-files', label: 'Generate Next.js App Router Project' },
  { id: 'install-or-resolve-dependencies', label: 'Resolve Project Manifest & Configs' },
  { id: 'run-static-validation', label: 'Run Static Code & Link Validation' },
  { id: 'prepare-preview', label: 'Prepare Project Preview & File Tree' },
  { id: 'package-project', label: 'Package Production ZIP Archive' },
];

export class ConversionService {
  private conversions: Map<string, ConversionRecord> = new Map();

  async init(): Promise<void> {
    await conversionStorage.init();
  }

  /**
   * Previews the scraped pages and suggested routes for a job before conversion
   */
  async getJobPreview(jobId: string): Promise<PageInventory> {
    const job = await jobRepository.getJobById(jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' not found`);
    }

    const results = await this.loadScrapeResults(jobId);
    const rawPages: RawScrapePageItem[] = results.items.map((r) => ({
      url: r.url,
      rawData: r.rawData as RawScrapePageItem['rawData'],
      normalizedData: r.normalizedData as RawScrapePageItem['normalizedData'],
    }));

    return buildPageInventory(jobId, job.targetUrl, job.domain, rawPages);
  }

  private async loadScrapeResults(jobId: string, urls?: string[]) {
    return loadBoundedSnapshot(jobId, urls);
  }

  async startConversion(jobId: string, options: ConversionOptions): Promise<ConversionRecord> {
    const job = await jobRepository.getJobById(jobId);
    if (!job) {
      throw new Error(`Job '${jobId}' was not found.`);
    }

    const conversionId = `conv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const stages: StageProgress[] = STAGES.map((s) => ({
      id: s.id,
      label: s.label,
      status: 'pending',
    }));

    const record: ConversionRecord = {
      id: conversionId,
      jobId,
      status: 'PENDING',
      currentStage: 'validate-input',
      stages,
      options,
      totalFilesGenerated: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.conversions.set(conversionId, record);

    // Launch pipeline asynchronously
    this.runPipeline(conversionId, job, options).catch((err) => {
      logger.error({ conversionId, error: err }, 'Conversion pipeline failed unexpectedly');
    });

    return record;
  }

  getConversion(conversionId: string): ConversionRecord | null {
    return this.conversions.get(conversionId) || null;
  }

  async getGeneratedFile(conversionId: string, filePath: string): Promise<string | null> {
    return conversionStorage.readFileSafe(conversionId, filePath);
  }

  private updateStage(
    record: ConversionRecord,
    stageId: ConversionStageId,
    status: StageProgress['status'],
    message?: string
  ): void {
    const stage = record.stages.find((s) => s.id === stageId);
    if (!stage) return;

    stage.status = status;
    record.currentStage = stageId;
    record.updatedAt = new Date().toISOString();

    if (status === 'running') {
      stage.startedAt = new Date().toISOString();
    } else if (status === 'completed' || status === 'failed') {
      stage.finishedAt = new Date().toISOString();
      if (stage.startedAt) {
        stage.durationMs = Date.now() - new Date(stage.startedAt).getTime();
      }
    }
    if (message) stage.message = message;
    record.operationLogs ??= [];
    record.operationLogs.push({ timestamp: record.updatedAt, stageId, status, message: message || stage.label });
    if (record.operationLogs.length > 200) record.operationLogs.splice(0, record.operationLogs.length - 200);
  }

  /**
   * Executes all pipeline stages deterministically
   */
  private async runPipeline(
    conversionId: string,
    job: Awaited<ReturnType<typeof jobRepository.getJobById>>,
    options: ConversionOptions
  ): Promise<void> {
    const record = this.conversions.get(conversionId)!;
    record.status = 'IN_PROGRESS';
    const log = logger.child({ conversionId, jobId: job!.id });

    try {
      // 1. Stage: validate-input
      this.updateStage(record, 'validate-input', 'running', 'Validating options & parameters');
      await conversionStorage.setupConversionWorkspace(conversionId);
      this.updateStage(record, 'validate-input', 'completed', 'Input options validated');

      // 2. Stage: load-scrape-snapshot
      this.updateStage(record, 'load-scrape-snapshot', 'running', 'Loading scraped HTML documents');
      const results = await this.loadScrapeResults(job!.id, options.pages);
      if (results.items.length === 0) {
        throw new Error('No scraped page results exist for this job. Please run a scrape first.');
      }
      this.updateStage(
        record,
        'load-scrape-snapshot',
        'completed',
        `Loaded ${results.items.length} scraped page(s)`
      );

      // 3. Stage: build-page-inventory
      this.updateStage(record, 'build-page-inventory', 'running', 'Mapping pages to Next.js routes');
      const selectedPages = options.pages && options.pages.length > 0
        ? results.items.filter((r) => options.pages.includes(r.url))
        : results.items;

      if (selectedPages.length === 0) {
        throw new Error('None of the selected pages matched the scraped results for this job.');
      }

      const rawPages: RawScrapePageItem[] = selectedPages.map((r) => ({
        url: r.url,
        rawData: r.rawData as RawScrapePageItem['rawData'],
        normalizedData: r.normalizedData as RawScrapePageItem['normalizedData'],
      }));

      const missingHtml = rawPages.filter((page) => typeof page.rawData?.html !== 'string' || !page.rawData.html.trim());
      if (missingHtml.length) {
        throw new Error(`Cannot convert ${missingHtml.length} page(s) without saved HTML. Scrape again with extractHtml enabled: ${missingHtml.map((page) => page.url).join(', ')}`);
      }

      const videoWarnings: string[] = [];
      for (const page of rawPages) {
        const warnings: string[] = [];
        page.rawData = { ...page.rawData, html: applyVideoPolicy(removeSnapshotLoaders(page.rawData!.html!, []).html, warnings) };
        videoWarnings.push(...warnings.map(warning => `${page.url}: ${warning}`));
      }
      const inventory = buildPageInventory(job!.id, job!.targetUrl, job!.domain, rawPages);
      record.inventory = inventory;
      this.updateStage(
        record,
        'build-page-inventory',
        'completed',
        `Mapped ${inventory.pages.length} route(s): ${inventory.routes.join(', ')}`
      );

      // 4. Stage: resolve-assets
      this.updateStage(record, 'resolve-assets', 'running', 'Collecting and downloading images, fonts, and CSS');
      const allDiscoveredAssets: DiscoveredAsset[] = [];
      const allInlineStyles: Array<{ css: string; sourceUrl: string }> = [];

      for (const p of rawPages) {
        const html = p.rawData?.html || '';
        if (html) {
          const pageAssets = assetCollector.collectAssets(html, p.url);
          allDiscoveredAssets.push(...pageAssets);

          const pageInlineStyles = assetCollector.collectInlineStyles(html);
          for (const css of pageInlineStyles) {
            allInlineStyles.push({ css, sourceUrl: p.url });
          }
        }
      }

      const assetResult = await assetDownloader.resolveAssets(
        conversionId,
        allDiscoveredAssets,
        allInlineStyles,
        { assetRoot: 'cloned-assets' }
      );

      this.updateStage(
        record,
        'resolve-assets',
        'completed',
        `Resolved ${assetResult.downloadedAssets.length} asset(s), ${assetResult.missingAssets.length} skipped`
      );

      // 5. Stage: analyze-page-structure
      this.updateStage(record, 'analyze-page-structure', 'running', 'Analyzing DOM and extracting layout elements');
      const pageStructureList: PageStructureMap[] = [];
      const knownUrls = rawPages.map((p) => p.url);
      const preparedDocuments = rawPages.map((rawP, index) => {
        let html = rawP.rawData?.html || '';
        html = assetDownloader.rewriteAssetUrlsInHtml(html, assetResult.downloadedAssets, rawP.url);
        html = domAnalyzer.rewriteInternalLinks(html, inventory.targetUrl, knownUrls);
        return { id: String(index), html };
      });

      // Retain the consolidated and rewritten CSS (which includes external stylesheets and inline styles)
      const sourceCss = sanitizeGeneratedCss(assetResult.consolidatedCss, { strategy: options.cssStrategy });

      let documentsForAnalysis = preparedDocuments;
      let generatedCss = sourceCss;
      let tailwindSummary = '';
      if (options.cssStrategy === 'tailwind') {
        const migrated = convertDocumentsToTailwind(preparedDocuments, sourceCss);
        documentsForAnalysis = migrated.documents;
        generatedCss = migrated.residualCss;
        record.stylingReport = {
          strategy: 'tailwind',
          ...migrated.stats,
          residualCssBytes: Buffer.byteLength(migrated.residualCss, 'utf8'),
          warnings: migrated.warnings.map((warning) => warning.message),
        };
        tailwindSummary = ` Converted ${migrated.stats.declarationsConverted}/${migrated.stats.declarationsSeen} stylesheet declarations and ${migrated.stats.inlineDeclarationsConverted} inline declarations; ${migrated.warnings.length} conservative fallback warning(s).`;
      }

      for (let i = 0; i < rawPages.length; i++) {
        const structure = domAnalyzer.analyzePage(documentsForAnalysis[i].html, rawPages[i].url, inventory.targetUrl);
        pageStructureList.push({ route: inventory.pages[i].route, structure });
      }
      this.updateStage(record, 'analyze-page-structure', 'completed', `DOM analysis finished.${tailwindSummary}`);

      const siteBodyContext = deriveSiteBodyContext(
        pageStructureList.map((page, index) => ({ bodyContext: page.structure.bodyContext, html: documentsForAnalysis[index].html })),
        generatedCss
      );

      // 6. Stage: identify-shared-components
      this.updateStage(record, 'identify-shared-components', 'running', 'Identifying shared Header, Footer, and Sections');
      const sharedComponents = componentDetector.detectSharedComponents(pageStructureList);
      this.updateStage(
        record,
        'identify-shared-components',
        'completed',
        `Identified ${sharedComponents.length} shared component(s): ${sharedComponents.map((c) => c.name).join(', ') || 'None'}`
      );

      // 7. Stage: generate-nextjs-files
      this.updateStage(record, 'generate-nextjs-files', 'running', 'Writing Next.js App Router files and components');
      let filesCount = 0;
      let usesLottie = false;
      const generatedSvgAssets = new Map<string, GeneratedSvgAsset>();

      // 7a. Write globals.css
      const tailwindDirectives = options.cssStrategy === 'tailwind'
        ? '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n'
        : '';
      generatedCss = rewriteBodyContextSelectors(generatedCss);
      generatedCss = sanitizeGeneratedCss(generatedCss, { strategy: options.cssStrategy });
      const baseResetCss = `/* ========================================================
   Next.js Scraped Website Stylesheet
   ${options.cssStrategy === 'tailwind' ? 'Tailwind utilities with conservative residual CSS' : 'Preserved original CSS'} from ${job!.targetUrl}
   ======================================================== */

${tailwindDirectives}@layer base {
  *, ::before, ::after {
    box-sizing: border-box;
  }
  html {
    line-height: 1.5;
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
  }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }
}

${generatedCss}
`;
      await conversionStorage.writeFileSafe(conversionId, 'src/app/globals.css', baseResetCss);
      filesCount++;

      // 7b. Write Root Layout (app/layout.tsx)
      // Chrome stays in each route's original DOM position; do not hoist a
      // majority header/footer into the root layout of unrelated pages.
      const hasHeader = false;
      const hasFooter = false;
      const hasNav = false;

      const layoutCode = generateRootLayout({
        siteTitle: inventory.pages[0]?.title || job!.name || 'Generated Website',
        siteDescription: inventory.pages[0]?.description,
        hasHeader,
        hasFooter,
        hasNavigation: hasNav,
        bodyClassName: siteBodyContext.className,
        preserveSourceLayout: true,
      });
      await conversionStorage.writeFileSafe(conversionId, 'src/app/layout.tsx', layoutCode);
      filesCount++;

      // Section files are emitted by page composition and rendered in place,
      // rather than producing unused shared components beside copied markup.

      // 7d. Write Page Routes (app/page.tsx, app/[route]/page.tsx)
      for (let i = 0; i < inventory.pages.length; i++) {
        const invItem = inventory.pages[i];
        const struct = pageStructureList[i]?.structure;
        const isRoot = invItem.route === '/';

        const pageGen = generatePageRoute({
          item: invItem,
          sourceRoot: 'src',
          pageNamespace: `page-${i + 1}`,
          svgRegistry: generatedSvgAssets,
          rawContentHtml: struct?.bodyContentHtml || struct?.mainContentHtml || '',
          bodyContentHtml: struct?.bodyContentHtml,
          sections: struct?.sections,
          componentExtraction: options.componentExtraction,
          isRoot,
          bodyContext: removeCommonBodyClasses(struct?.bodyContext, siteBodyContext.className),
        });
        usesLottie ||= pageGen.usesLottie;

        await conversionStorage.writeFileSafe(conversionId, pageGen.filePath, pageGen.code);
        for (const component of pageGen.generatedComponents || []) {
          await conversionStorage.writeFileSafe(conversionId, component.filePath, component.code);
          filesCount++;
        }
        for (const asset of pageGen.svgAssets) generatedSvgAssets.set(asset.hash, asset);
        filesCount++;
      }

      // Write each unique inline SVG once across shared components and pages.
      for (const asset of generatedSvgAssets.values()) {
        await conversionStorage.writeFileSafe(conversionId, asset.filePath, asset.code);
        filesCount++;
      }
      if (usesLottie) {
        await conversionStorage.writeFileSafe(conversionId, 'src/components/ui/LottieAsset.tsx', generateLottieAssetComponent());
        filesCount++;
      }

      // Do not emit generic interactive widgets unless page markup actually
      // references them. Static source controls do not imply restored behavior.

      this.updateStage(record, 'generate-nextjs-files', 'completed', `Generated ${filesCount} code file(s)`);

      // 8. Stage: install-or-resolve-dependencies
      this.updateStage(record, 'install-or-resolve-dependencies', 'running', 'Generating package.json, configs & docs');
      const projectOptions = {
        projectName: options.projectName,
        domain: job!.domain,
        targetUrl: job!.targetUrl,
        routes: inventory.pages.map((p) => ({ path: p.route, label: p.title })),
        pageCount: inventory.pages.length,
        cssStrategy: options.cssStrategy,
        usesLottie,
      };

      await conversionStorage.writeFileSafe(
        conversionId,
        'package.json',
        generatePackageJson(projectOptions)
      );
      await conversionStorage.writeFileSafe(conversionId, 'tsconfig.json', generateTsConfig('src'));
      if (options.cssStrategy === 'tailwind') {
        await conversionStorage.writeFileSafe(conversionId, 'tailwind.config.mjs', generateTailwindConfig('src'));
        filesCount++;
      }
      await conversionStorage.writeFileSafe(conversionId, 'postcss.config.mjs', generatePostCssConfig(options.cssStrategy));
      filesCount++;
      await conversionStorage.writeFileSafe(
        conversionId,
        'next.config.mjs',
        generateNextConfig(job!.domain)
      );
      await conversionStorage.writeFileSafe(
        conversionId,
        'src/lib/site-config.ts',
        generateSiteConfig(projectOptions)
      );
      await conversionStorage.writeFileSafe(conversionId, 'src/lib/utils.ts', generateUtils());
      await conversionStorage.writeFileSafe(
        conversionId,
        'README.md',
        generateReadme(projectOptions)
      );
      filesCount += 6;
      record.totalFilesGenerated = filesCount + assetResult.downloadedAssets.length;

      this.updateStage(
        record,
        'install-or-resolve-dependencies',
        'completed',
        'Config manifests and documentation ready'
      );

      // 9. Stage: run-static-validation
      this.updateStage(record, 'run-static-validation', 'running', 'Running static TypeScript & asset verification');
      const projectDir = conversionStorage.getProjectDir(conversionId);
      const validationReport = await staticValidator.validateProject(
        projectDir,
        inventory.routes,
        assetResult.downloadedAssets.map((a) => a.publicUrl),
        assetResult.missingAssets,
        options.cssStrategy
      );
      if (validationReport.passed) {
        try {
          await compileGeneratedCss(projectDir, options.cssStrategy);
        } catch (error) {
          validationReport.passed = false;
          validationReport.errors.push(`Generated CSS compilation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      validationReport.warnings.push(...videoWarnings);
      record.validationReport = validationReport;
      this.updateStage(
        record,
        'run-static-validation',
        validationReport.passed ? 'completed' : 'failed',
        validationReport.passed
          ? `Validation passed (${validationReport.checkedFilesCount} files, 0 errors, ${validationReport.warnings.length} warnings)`
          : `Validation issues detected: ${validationReport.errors.join('; ')}`
      );

      if (!validationReport.passed) {
        throw new Error(`Generated project validation failed; ZIP packaging blocked: ${validationReport.errors.join('; ')}`);
      }

      // 10. Stage: prepare-preview
      this.updateStage(record, 'prepare-preview', 'running', 'Building file hierarchy for inspection');
      const fileTree = await conversionStorage.buildFileTree(conversionId);
      record.fileTree = fileTree;
      this.updateStage(record, 'prepare-preview', 'completed', 'Preview tree constructed');

      // 11. Stage: package-project
      this.updateStage(record, 'package-project', 'running', 'Creating standalone ZIP bundle');
      const zipPath = conversionStorage.getZipPath(conversionId, options.projectName);
      const zipResult = await zipPackager.packageProject(projectDir, zipPath);
      record.zipFilePath = zipResult.zipPath;
      record.zipSizeBytes = zipResult.sizeBytes;

      this.updateStage(
        record,
        'package-project',
        'completed',
        `ZIP archive created: ${(zipResult.sizeBytes / 1024).toFixed(1)} KB`
      );

      record.status = 'COMPLETED';
      record.finishedAt = new Date().toISOString();
      log.info({ totalFiles: record.totalFilesGenerated, zipBytes: record.zipSizeBytes }, 'Conversion finished successfully');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      record.status = 'FAILED';
      record.errorMessage = msg;
      record.finishedAt = new Date().toISOString();
      this.updateStage(record, record.currentStage, 'failed', msg);
      log.error({ error: msg }, 'Conversion job failed');
    }
  }
}

export const conversionService = new ConversionService();


