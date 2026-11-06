import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { conversionService } from '../../generator/conversion.service.js';
import { ConversionOptionsSchema } from '../../generator/types.js';
import { conversionStorage } from '../../generator/storage.js';
import { sitePreviewService, PreviewBusyError } from '../../generator/preview.service.js';

const ConversionIdParamsSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) });

const StartConversionSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  options: ConversionOptionsSchema.partial().default({}),
});

export const conversionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onClose', async () => { await sitePreviewService.close(); });

  fastify.post('/api/v1/conversions/:id/preview', async (request, reply) => {
    const { id } = ConversionIdParamsSchema.parse(request.params);
    const conversion = conversionService.getConversion(id);
    if (!conversion) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Conversion not found.' } });
    if (conversion.status !== 'COMPLETED' || conversion.validationReport?.passed !== true) {
      return reply.code(409).send({ success: false, error: { code: 'PREVIEW_NOT_READY', message: 'Complete a validated conversion before starting its preview.' } });
    }
    try {
      return reply.code(202).send({ success: true, data: sitePreviewService.start(id) });
    } catch (error) {
      if (error instanceof PreviewBusyError) return reply.code(409).send({ success: false, error: { code: 'PREVIEW_BUSY', message: error.message } });
      throw error;
    }
  });

  fastify.get('/api/v1/conversions/:id/preview', async (request, reply) => {
    const { id } = ConversionIdParamsSchema.parse(request.params);
    const preview = sitePreviewService.get(id);
    if (!preview) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'No preview has been started for this conversion.' } });
    return { success: true, data: preview };
  });

  fastify.delete('/api/v1/conversions/:id/preview', async (request, reply) => {
    const { id } = ConversionIdParamsSchema.parse(request.params);
    const preview = await sitePreviewService.stop(id);
    if (!preview) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Preview not found.' } });
    return { success: true, data: preview };
  });
  // 1. GET /api/v1/jobs/:jobId/conversion-preview - Inspect pages and proposed routes before converting
  fastify.get('/api/v1/jobs/:jobId/conversion-preview', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    try {
      const preview = await conversionService.getJobPreview(jobId);
      return {
        success: true,
        data: preview,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: msg },
      });
    }
  });

  // 2. POST /api/v1/conversions - Start converting a scrape job into a Next.js project
  fastify.post('/api/v1/conversions', async (request, reply) => {
    const parsed = StartConversionSchema.parse(request.body);

    try {
      // If no pages were specified, default to all pages from the job preview
      let pages = parsed.options.pages;
      if (!pages || pages.length === 0) {
        const preview = await conversionService.getJobPreview(parsed.jobId);
        pages = preview.pages.map((p) => p.url);
      }

      const fullOptions = ConversionOptionsSchema.parse({
        ...parsed.options,
        pages,
      });

      const conversion = await conversionService.startConversion(parsed.jobId, fullOptions);

      return reply.status(202).send({
        success: true,
        data: conversion,
        message: 'Next.js project generation started.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({
        success: false,
        error: { code: 'CONVERSION_START_FAILED', message: msg },
      });
    }
  });

  // 3. GET /api/v1/conversions/:id - Poll conversion status and preview tree
  fastify.get('/api/v1/conversions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversion = conversionService.getConversion(id);

    if (!conversion) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Conversion '${id}' was not found.` },
      });
    }

    return {
      success: true,
      data: conversion,
    };
  });

  // 4. GET /api/v1/conversions/:id/download - Stream the completed ZIP archive
  fastify.get('/api/v1/conversions/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const conversion = conversionService.getConversion(id);

    if (!conversion) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: `Conversion '${id}' was not found.` },
      });
    }

    if (conversion.status !== 'COMPLETED' || !conversion.zipFilePath || conversion.validationReport?.passed !== true) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'ZIP_NOT_READY',
          message: `Conversion '${id}' is not yet completed (current status: ${conversion.status}).`,
        },
      });
    }

    const filename = `${conversion.options.projectName || 'nextjs-project'}.zip`;
    const stream = conversionStorage.createZipStream(conversion.zipFilePath);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    if (conversion.zipSizeBytes) {
      reply.header('Content-Length', conversion.zipSizeBytes);
    }

    return reply.send(stream);
  });

  // 5. GET /api/v1/conversions/:id/files/* - Read individual generated file content
  fastify.get('/api/v1/conversions/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = (request.params as Record<string, string>)['*'];

    if (!filePath) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'File path must be provided' },
      });
    }

    try {
      const content = await conversionService.getGeneratedFile(id, filePath);
      if (content === null) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `File '${filePath}' not found in conversion '${id}'.` },
        });
      }

      return {
        success: true,
        data: {
          path: filePath,
          content,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({
        success: false,
        error: { code: 'READ_FAILED', message: msg },
      });
    }
  });
};
