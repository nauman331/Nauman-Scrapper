import { prisma } from '../prisma.js';
import type { Prisma } from '@prisma/client';

export interface CreateJobInput {
  name?: string;
  targetUrl: string;
  domain: string;
  strategy: 'AUTO' | 'CHEERIO' | 'PLAYWRIGHT';
  proxyId?: string;
  priority?: number;
  maxDepth?: number;
  maxPages?: number;
  requestTimeoutMs?: number;
  retryLimit?: number;
  extractionConfig: string;
  domainPolicyId?: string;
}

export interface ListJobsQuery {
  status?: string;
  domain?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export class JobRepository {
  async createJob(input: CreateJobInput) {
    return prisma.scrapeJob.create({
      data: {
        name: input.name,
        targetUrl: input.targetUrl,
        domain: input.domain,
        strategy: input.strategy,
        proxyId: input.proxyId,
        priority: input.priority ?? 0,
        maxDepth: input.maxDepth ?? 1,
        maxPages: input.maxPages ?? 10,
        requestTimeoutMs: input.requestTimeoutMs ?? 30000,
        retryLimit: input.retryLimit ?? 3,
        extractionConfig: input.extractionConfig,
        domainPolicyId: input.domainPolicyId,
        status: 'PENDING',
      },
    });
  }

  async getJobById(id: string) {
    return prisma.scrapeJob.findUnique({
      where: { id },
      include: {
        domainPolicy: true,
        attempts: {
          orderBy: { attemptNumber: 'desc' },
          take: 5,
        },
      },
    });
  }

  async listJobs(query: ListJobsQuery = {}) {
    const limit = Math.min(query.limit ?? 20, 100);
    const offset = query.offset ?? 0;
    const where: Prisma.ScrapeJobWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.domain) {
      where.domain = query.domain;
    }

    const [items, total] = await Promise.all([
      prisma.scrapeJob.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: query.order ?? 'desc' },
        include: {
          _count: {
            select: {
              results: true,
              crawledPages: true,
              attempts: true,
            },
          },
        },
      }),
      prisma.scrapeJob.count({ where }),
    ]);

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async updateJobStatus(
    id: string,
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'CANCELLED',
    updates: {
      errorMessage?: string | null;
      startedAt?: Date | null;
      finishedAt?: Date | null;
    } = {}
  ) {
    return prisma.scrapeJob.update({
      where: { id },
      data: {
        status,
        ...updates,
      },
    });
  }

  async incrementCounts(
    id: string,
    counts: { totalPagesCrawled?: number; totalResultsExtracted?: number }
  ) {
    return prisma.scrapeJob.update({
      where: { id },
      data: {
        ...(counts.totalPagesCrawled && {
          totalPagesCrawled: { increment: counts.totalPagesCrawled },
        }),
        ...(counts.totalResultsExtracted && {
          totalResultsExtracted: { increment: counts.totalResultsExtracted },
        }),
      },
    });
  }

  async createAttempt(jobId: string, attemptNumber: number, workerId?: string) {
    return prisma.jobAttempt.create({
      data: {
        jobId,
        attemptNumber,
        status: 'RUNNING',
        workerId,
      },
    });
  }

  async updateAttempt(
    attemptId: string,
    status: 'RUNNING' | 'COMPLETED' | 'FAILED',
    errorMessage?: string
  ) {
    return prisma.jobAttempt.update({
      where: { id: attemptId },
      data: {
        status,
        errorMessage,
        finishedAt: new Date(),
      },
    });
  }
}

export const jobRepository = new JobRepository();
