import type { FastifyPluginAsync } from 'fastify';
import { healthService } from '../../monitoring/health.service.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => {
    return healthService.getLiveness();
  });

  fastify.get('/ready', async (_, reply) => {
    const readiness = await healthService.getReadiness();
    if (readiness.status === 'error') {
      return reply.status(503).send(readiness);
    }
    return reply.status(200).send(readiness);
  });
};
