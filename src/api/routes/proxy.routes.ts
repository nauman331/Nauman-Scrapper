import type { FastifyPluginAsync } from 'fastify';
import { BulkProxyImportSchema, CreateProxySchema, ProxyIdParamsSchema } from '../../proxies/proxy.types.js';
import { proxyService } from '../../proxies/proxy.service.js';

export const proxyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/api/v1/proxies', async (request, reply) => {
    const proxy = await proxyService.create(CreateProxySchema.parse(request.body));
    return reply.status(201).send({ success: true, data: proxy });
  });

  fastify.post('/api/v1/proxies/import', async (request, reply) => {
    const result = await proxyService.importBulk(BulkProxyImportSchema.parse(request.body));
    return reply.status(201).send({ success: true, data: result });
  });

  fastify.get('/api/v1/proxies', async () => ({ success: true, data: await proxyService.list() }));

  fastify.delete('/api/v1/proxies/:id', async (request, reply) => {
    const { id } = ProxyIdParamsSchema.parse(request.params);
    if (!(await proxyService.delete(id))) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proxy not found' } });
    return reply.status(204).send();
  });

  fastify.post('/api/v1/proxies/:id/test', async (request, reply) => {
    const { id } = ProxyIdParamsSchema.parse(request.params);
    const proxy = await proxyService.test(id);
    if (!proxy) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Proxy not found' } });
    return { success: true, data: proxy };
  });
};
