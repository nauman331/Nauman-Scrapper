import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import path from 'node:path';
import { createExactPreviewSession, getExactPreviewConversion } from '../../generator/exact-preview.js';
import { ExactConversionOptionsSchema } from '../../generator/exact-types.js';
import { exactConversionService } from '../../generator/exact-conversion.service.js';
import { conversionStorage } from '../../generator/storage.js';

const StartSchema = z.object({ options: ExactConversionOptionsSchema.default(() => ExactConversionOptionsSchema.parse({})) });
const FileQuerySchema = z.object({ path: z.string().min(1).max(1024) });
const errorResponse = (code: string, message: string) => ({ success: false, error: { code, message } });

export const exactConversionRoutes: FastifyPluginAsync = async (fastify) => {
  for (const prefix of ['/api', '/api/v1']) {
    fastify.post(`${prefix}/jobs/:id/convert/exact`, async (request, reply) => {
      const parsed = StartSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send(errorResponse('BAD_REQUEST', parsed.error.message));
      try {
        const record = await exactConversionService.startConversion((request.params as { id: string }).id, parsed.data.options);
        return reply.code(202).send({ success: true, data: record, message: 'Exact static HTML export started; source CSS is preserved, executable behavior is not copied.' });
      } catch (error) {
        return reply.code(404).send(errorResponse('NOT_FOUND', error instanceof Error ? error.message : String(error)));
      }
    });
    fastify.get(`${prefix}/jobs/:id/convert/exact/preview`, async (request, reply) => {
      try { return { success: true, data: await exactConversionService.getJobPreview((request.params as { id: string }).id) }; }
      catch (error) { return reply.code(404).send(errorResponse('NOT_FOUND', error instanceof Error ? error.message : String(error))); }
    });
    fastify.get(`${prefix}/exact-conversions/:id`, async (request, reply) => {
      const record = exactConversionService.getConversion((request.params as { id: string }).id);
      if (!record) return reply.code(404).send(errorResponse('NOT_FOUND', 'Exact conversion not found.'));
      return { success: true, data: record };
    });
    fastify.get(`${prefix}/exact-conversions/:id/files`, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const parsed = FileQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send(errorResponse('BAD_REQUEST', 'A non-empty path query parameter is required.'));
      if (!exactConversionService.getConversion(id)) return reply.code(404).send(errorResponse('NOT_FOUND', 'Exact conversion not found.'));
      try {
        const content = await exactConversionService.getGeneratedFile(id, parsed.data.path);
        if (content === null) return reply.code(404).send(errorResponse('NOT_FOUND', 'Generated file not found.'));
        return { success: true, data: { path: parsed.data.path, content } };
      } catch (error) { return reply.code(400).send(errorResponse('READ_FAILED', error instanceof Error ? error.message : String(error))); }
    });
    fastify.post(`${prefix}/exact-conversions/:id/preview`, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const record = exactConversionService.getConversion(id);
      if (!record) return reply.code(404).send(errorResponse('NOT_FOUND', 'Exact conversion not found.'));
      if (record.status !== 'COMPLETED') return reply.code(400).send(errorResponse('PREVIEW_NOT_READY', 'Complete the conversion before previewing it.'));
      reply.header('Cache-Control', 'no-store');
      return { success: true, data: { baseUrl: `${prefix}/exact-preview/${createExactPreviewSession(id)}/` } };
    });
    fastify.get(`${prefix}/exact-preview/:token/*`, async (request, reply) => {
      const params = request.params as { token: string; '*': string };
      const id = getExactPreviewConversion(params.token);
      if (!id) return reply.code(404).send(errorResponse('PREVIEW_EXPIRED', 'Preview expired. Reload the preview to continue.'));
      const filePath = params['*'] || 'index.html';
      const contentTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
      };
      const contentType = contentTypes[path.extname(filePath).toLowerCase()];
      if (!contentType) return reply.code(404).send(errorResponse('NOT_FOUND', 'Not a previewable static file.'));
      try {
        const content = await conversionStorage.readPreviewFileSafe(id, filePath);
        if (content === null) return reply.code(404).send(errorResponse('NOT_FOUND', 'Preview file not found.'));
        reply.header('Cache-Control', 'no-store');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
        reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; media-src 'self' https:; frame-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");
        return reply.type(contentType).send(content);
      } catch { return reply.code(400).send(errorResponse('INVALID_PATH', 'Invalid preview file path.')); }
    });
    fastify.get(`${prefix}/exact-conversions/:id/download`, async (request, reply) => {
      const record = exactConversionService.getConversion((request.params as { id: string }).id);
      if (!record) return reply.code(404).send(errorResponse('NOT_FOUND', 'Exact conversion not found.'));
      if (record.status !== 'COMPLETED' || !record.zipFilePath) return reply.code(400).send(errorResponse('ZIP_NOT_READY', `Exact conversion status: ${record.status}.`));
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${record.options.projectName}.zip"`);
      if (record.zipSizeBytes) reply.header('Content-Length', record.zipSizeBytes);
      return reply.send(conversionStorage.createZipStream(record.zipFilePath));
    });
  }
};
