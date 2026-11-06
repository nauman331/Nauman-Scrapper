import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import crypto from 'node:crypto';
import { logger } from '../monitoring/logger.js';
import { errorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.plugin.js';
import { healthRoutes } from './routes/health.routes.js';
import { jobRoutes } from './routes/job.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';
import { conversionRoutes } from './routes/conversion.routes.js';
import { htmlConversionRoutes } from './routes/html-conversion.routes.js';
import { exactConversionRoutes } from './routes/exact-conversion.routes.js';
import { conversionService } from '../generator/conversion.service.js';
import { renderPlaygroundHtml } from './views/playground.html.js';
import { renderDocsHtml } from './views/docs.html.js';
import { ENV } from '../config/env.js';
import { DASHBOARD_ROUTES } from './views/dashboard-routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const server = fastify({
    logger: false, // We use structured Pino logger hooks
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    trustProxy: true,
  });

  // Security Headers
  await server.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Cross-Origin Resource Sharing
  await server.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Request logging hook
  server.addHook('onRequest', async (req) => {
    logger.debug({ reqId: req.id, method: req.method, url: req.url }, 'Incoming HTTP request');
  });

  server.addHook('onResponse', async (req, reply) => {
    logger.info(
      {
        reqId: req.id,
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      'HTTP request completed'
    );
  });

  // Register Error Handler
  server.setErrorHandler(errorHandler);

  // Register Authentication
  await server.register(authPlugin);

  // 1. Home Playground Route (GET /)
  server.get('/', async (request, reply) => {
    const accept = request.headers.accept || '';

    if (accept.includes('text/html') || !accept.includes('application/json')) {
      reply.type('text/html; charset=utf-8');
      return renderPlaygroundHtml();
    }

    return {
      name: 'Production Web Scraping Platform API',
      version: '1.0.0',
      status: 'online',
      playground: '/',
      documentation: '/docs',
      endpoints: {
        health: '/health',
        readiness: '/ready',
        jobs: '/api/v1/jobs',
      },
      configuration: {
        databaseUrl: ENV.DATABASE_URL,
        queueAdapter: ENV.QUEUE_ADAPTER,
        defaultConcurrency: ENV.DEFAULT_CONCURRENCY,
      },
    };
  });

  // Direct navigation and refresh load the dashboard shell at each section URL.
  for (const route of Object.values(DASHBOARD_ROUTES)) {
    server.get(route, async (_request, reply) => {
      return reply.type('text/html; charset=utf-8').send(renderPlaygroundHtml());
    });
  }

  // 2. Documentation Route (GET /docs)
  server.get('/docs', async (request, reply) => {
    const accept = request.headers.accept || '';

    if (accept.includes('text/html') || !accept.includes('application/json')) {
      reply.type('text/html; charset=utf-8');
      return renderDocsHtml();
    }

    return {
      documentation: 'Production Web Scraping Platform API Documentation',
      endpoints: [
        { method: 'POST', path: '/api/v1/jobs', description: 'Create and enqueue a scrape job' },
        { method: 'GET', path: '/api/v1/jobs', description: 'List scrape jobs with pagination' },
        { method: 'GET', path: '/api/v1/jobs/:id', description: 'Get specific job status and attempt history' },
        { method: 'POST', path: '/api/v1/jobs/:id/cancel', description: 'Cancel an active or pending job' },
        { method: 'POST', path: '/api/v1/jobs/:id/retry', description: 'Reprocess a failed job' },
        { method: 'GET', path: '/api/v1/jobs/:id/results', description: 'Get extracted normalized data records' },
        { method: 'GET', path: '/api/v1/jobs/:id/clean-data', description: 'Get one aggregated clean data record' },
        { method: 'GET', path: '/api/v1/jobs/:id/pages', description: 'Get crawled HTTP pages operational log' },
        { method: 'GET', path: '/api/v1/jobs/:jobId/conversion-preview', description: 'Preview page inventory & routes for Next.js conversion' },
        { method: 'POST', path: '/api/v1/conversions', description: 'Convert scraped website into a Next.js App Router project' },
        { method: 'GET', path: '/api/v1/conversions/:id', description: 'Get conversion status, stage progress, and file tree' },
        { method: 'GET', path: '/api/v1/conversions/:id/download', description: 'Download complete generated Next.js project as ZIP' },
        { method: 'GET', path: '/api/v1/conversions/:id/files/*', description: 'Read generated file content in browser' },
        { method: 'GET', path: '/health', description: 'Liveness probe' },
        { method: 'GET', path: '/ready', description: 'Readiness probe' },
      ],
    };
  });

  // Initialize conversion service storage
  await conversionService.init();

  // Register Routes
  await server.register(healthRoutes);
  await server.register(jobRoutes);
  await server.register(proxyRoutes);
  await server.register(conversionRoutes);
  await server.register(htmlConversionRoutes);
  await server.register(exactConversionRoutes);

  return server;
}

export async function startServer(): Promise<FastifyInstance> {
  const app = await buildServer();
  await app.listen({ port: ENV.PORT, host: ENV.HOST });

  const hostDisplay = ENV.HOST === '0.0.0.0' ? 'localhost' : ENV.HOST;
  const localUrl = `http://${hostDisplay}:${ENV.PORT}`;

  console.log(`\n  Playground: ${localUrl}/\n`);

  return app;
}
