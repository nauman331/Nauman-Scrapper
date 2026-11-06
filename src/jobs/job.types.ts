import { z } from 'zod';
import { ExtractionConfigSchema } from '../extraction/schemas/extraction.schema.js';

export const CreateJobRequestSchema = z.object({
  name: z.string().optional(),
  targetUrl: z.string().url('Must be a valid URL'),
  strategy: z.enum(['AUTO', 'CHEERIO', 'PLAYWRIGHT']).default('AUTO'),
  proxyId: z.string().cuid().optional(),
  priority: z.coerce.number().min(-10).max(100).default(0),
  maxDepth: z.coerce.number().min(0).max(10).default(1),
  maxPages: z.coerce.number().min(1).max(500).default(10),
  requestTimeoutMs: z.coerce.number().min(1000).max(120000).default(30000),
  retryLimit: z.coerce.number().min(0).max(10).default(3),
  extractionConfig: ExtractionConfigSchema.default({
    extractHtml: true,
    extractMetadata: true,
    extractHeadings: true,
    extractMainText: true,
    extractLinks: true,
    discoverLinks: false,
    specificPageKeywords: [],
    filterInternalLinksOnly: true,
    maxLinksPerPage: 100,
    extractImages: false,
    extractJsonLd: true,
    customSelectors: [],
    requiredFields: [],
  }),
});

export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const ListJobsQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'])
    .optional(),
  domain: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type ListJobsQuery = z.infer<typeof ListJobsQuerySchema>;
