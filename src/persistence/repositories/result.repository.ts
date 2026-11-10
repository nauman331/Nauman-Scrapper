import { prisma } from '../prisma.js';
import { hashUrl } from '../../core/domain/url-normalizer.js';
import type { NormalizedPageData, ExtractionValidationResult } from '../../extraction/schemas/extraction.schema.js';

function parseStoredJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

export interface SaveCrawledPageInput {
  jobId: string;
  url: string;
  canonicalUrl?: string | null;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
  contentType?: string | null;
  byteSize?: number | null;
  depth?: number;
  crawlerStrategy: string;
  error?: string | null;
}

export interface SaveResultInput {
  jobId: string;
  crawledPageId?: string | null;
  url: string;
  normalizedData: NormalizedPageData;
  validation: ExtractionValidationResult;
}

export class ResultRepository {
  /**
   * Persists an operational log record for a fetched page
   */
  async saveCrawledPage(input: SaveCrawledPageInput) {
    return prisma.crawledPage.create({
      data: {
        jobId: input.jobId,
        url: input.url,
        canonicalUrl: input.canonicalUrl,
        httpStatus: input.httpStatus,
        responseTimeMs: input.responseTimeMs,
        contentType: input.contentType,
        byteSize: input.byteSize,
        depth: input.depth ?? 0,
        crawlerStrategy: input.crawlerStrategy,
        error: input.error,
      },
    });
  }

  /**
   * Idempotently saves extracted page data using composite unique constraint [jobId, urlHash].
   * If the URL was already saved for this job, it updates the record rather than duplicating it.
   */
  async saveResultIdempotent(input: SaveResultInput) {
    const urlHash = hashUrl(input.url);
    const title = input.normalizedData.metadata?.title || null;
    const description = input.normalizedData.metadata?.description || null;
    const rawDataJson = JSON.stringify(input.normalizedData);
    const normalizedDataJson = JSON.stringify({
      title,
      description,
      canonicalUrl: input.normalizedData.metadata?.canonicalUrl || null,
      headings: input.normalizedData.headings,
      mainText: input.normalizedData.mainText,
      linksCount: input.normalizedData.links?.length || 0,
      imagesCount: input.normalizedData.images?.length || 0,
      jsonLd: input.normalizedData.jsonLd,
      custom: input.normalizedData.custom,
      redditPosts: input.normalizedData.redditPosts,
      nextPageUrl: input.normalizedData.nextPageUrl,
    });
    const validationErrorsJson =
      input.validation.errors.length > 0 ? JSON.stringify(input.validation.errors) : null;

    return prisma.scrapeResult.upsert({
      where: {
        jobId_urlHash: {
          jobId: input.jobId,
          urlHash,
        },
      },
      update: {
        crawledPageId: input.crawledPageId,
        title,
        description,
        rawData: rawDataJson,
        normalizedData: normalizedDataJson,
        validationPassed: input.validation.passed,
        validationErrors: validationErrorsJson,
        extractedAt: new Date(),
      },
      create: {
        jobId: input.jobId,
        crawledPageId: input.crawledPageId,
        url: input.url,
        urlHash,
        title,
        description,
        rawData: rawDataJson,
        normalizedData: normalizedDataJson,
        validationPassed: input.validation.passed,
        validationErrors: validationErrorsJson,
      },
    });
  }

  async getResultsByJobId(
    jobId: string,
    options: {
      limit?: number;
      offset?: number;
      validationPassed?: boolean;
      urls?: string[];
    } = {}
  ) {
    const limit = Math.min(options.limit ?? 50, 200);
    const offset = options.offset ?? 0;
    const where: { jobId: string; validationPassed?: boolean; url?: { in: string[] } } = { jobId };
    if (options.urls?.length) where.url = { in: options.urls };

    if (typeof options.validationPassed === 'boolean') {
      where.validationPassed = options.validationPassed;
    }

    const [items, total] = await Promise.all([
      prisma.scrapeResult.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { extractedAt: 'asc' },
      }),
      prisma.scrapeResult.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        rawData: parseStoredJson(item.rawData, {}),
        normalizedData: parseStoredJson(item.normalizedData, {}),
        validationErrors: item.validationErrors ? parseStoredJson(item.validationErrors, []) : [],
      })),
      total,
      limit,
      offset,
    };
  }

  async getCrawledPagesByJobId(jobId: string, options: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(options.limit ?? 50, 200);
    const offset = options.offset ?? 0;

    const [items, total] = await Promise.all([
      prisma.crawledPage.findMany({
        where: { jobId },
        take: limit,
        skip: offset,
        orderBy: { crawledAt: 'asc' },
      }),
      prisma.crawledPage.count({ where: { jobId } }),
    ]);

    return {
      items,
      total,
      limit,
      offset,
    };
  }
}

export const resultRepository = new ResultRepository();
