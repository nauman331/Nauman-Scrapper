import type { ExtractionConfig } from '../extraction/schemas/extraction.schema.js';

export interface CrawlJobInput {
  jobId: string;
  targetUrl: string;
  domain: string;
  strategy: 'AUTO' | 'CHEERIO' | 'PLAYWRIGHT';
  maxDepth: number;
  maxPages: number;
  requestTimeoutMs: number;
  retryLimit: number;
  proxyUrl?: string;
  extractionConfig: ExtractionConfig;
  minDelayMs?: number;
  maxConcurrency?: number;
}

export interface CrawlExecutionSummary {
  jobId: string;
  totalPagesCrawled: number;
  totalResultsExtracted: number;
  failedPages: number;
  durationMs: number;
  status: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED';
  errors: string[];
}

export interface ICrawlerRunner {
  run(job: CrawlJobInput, isCancelled?: () => boolean): Promise<CrawlExecutionSummary>;
}
