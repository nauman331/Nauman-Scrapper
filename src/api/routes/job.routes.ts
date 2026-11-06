import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CreateJobRequestSchema, ListJobsQuerySchema } from '../../jobs/job.types.js';
import { jobService } from '../../jobs/job.service.js';

const ResultsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
  validationPassed: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
});

export const jobRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. POST /api/v1/jobs - Create and enqueue a scrape job
  fastify.post('/api/v1/jobs', async (request, reply) => {
    const validatedInput = CreateJobRequestSchema.parse(request.body);
    const job = await jobService.createJob(validatedInput);

    return reply.status(201).send({
      success: true,
      data: job,
    });
  });

  // 2. GET /api/v1/jobs - List scrape jobs with filtering and pagination
  fastify.get('/api/v1/jobs', async (request) => {
    const query = ListJobsQuerySchema.parse(request.query);
    const result = await jobService.listJobs(query);

    return {
      success: true,
      data: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    };
  });

  // 3. GET /api/v1/jobs/:id - Get details of a specific job
  fastify.get('/api/v1/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await jobService.getJob(id);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Job with ID '${id}' was not found.` },
      });
    }

    return {
      success: true,
      data: job,
    };
  });

  // 4. POST /api/v1/jobs/:id/cancel - Cancel a pending or running job
  fastify.post('/api/v1/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cancelled = await jobService.cancelJob(id);

    if (!cancelled) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CANNOT_CANCEL',
          message: `Job '${id}' could not be cancelled. It may not exist or is already completed/cancelled.`,
        },
      });
    }

    return {
      success: true,
      message: `Job '${id}' has been cancelled.`,
    };
  });

  // 5. POST /api/v1/jobs/:id/retry - Controlled reprocessing of a failed job
  fastify.post('/api/v1/jobs/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const retriedJob = await jobService.retryJob(id);
      return {
        success: true,
        data: retriedJob,
        message: `Job '${id}' re-enqueued for execution.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({
        success: false,
        error: { code: 'RETRY_FAILED', message: msg },
      });
    }
  });

  // 6. GET /api/v1/jobs/:id/results - Fetch extracted results
  fastify.get('/api/v1/jobs/:id/results', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = ResultsQuerySchema.parse(request.query);

    const results = await jobService.getJobResults(id, query);
    if (!results) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Job with ID '${id}' was not found.` },
      });
    }

    return {
      success: true,
      data: results.items,
      pagination: {
        total: results.total,
        limit: results.limit,
        offset: results.offset,
      },
    };
  });

  // 7. GET /api/v1/jobs/:id/clean-data - Aggregate stable, reusable clean data
  fastify.get('/api/v1/jobs/:id/clean-data', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cleanData = await jobService.getCleanData(id);
    if (!cleanData) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: `Job with ID '${id}' was not found.` } });
    return { success: true, data: cleanData };
  });

  // 8. GET /api/v1/jobs/:id/pages - Fetch crawled pages operational logs
  fastify.get('/api/v1/jobs/:id/pages', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = ResultsQuerySchema.parse(request.query);

    const pages = await jobService.getJobPages(id, query);
    if (!pages) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Job with ID '${id}' was not found.` },
      });
    }

    return {
      success: true,
      data: pages.items,
      pagination: {
        total: pages.total,
        limit: pages.limit,
        offset: pages.offset,
      },
    };
  });
};
