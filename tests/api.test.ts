import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import { connectDatabase, disconnectDatabase } from '../src/persistence/prisma.js';
import { ENV } from '../src/config/env.js';

describe('Fastify REST API Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await connectDatabase();
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectDatabase();
  });

  it('GET /health should return 200 and liveness data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.memoryUsageMb).toBeDefined();
  });

  it('GET /ready should return 200 and readiness status for DB and queue', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.queue.status).toBe('up');
  });

  it('POST /api/v1/jobs should reject request with 401 when API key is missing or invalid', async () => {
    // If API_KEY is set in ENV
    if (ENV.API_KEY) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/jobs',
        headers: {
          'x-api-key': 'wrong-key-12345',
        },
        payload: {
          targetUrl: 'https://example.com',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_API_KEY');
    }
  });

  it('POST /api/v1/jobs should create a new job and return 201 Created', async () => {
    const headers: Record<string, string> = {};
    if (ENV.API_KEY) {
      headers['x-api-key'] = ENV.API_KEY;
    }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers,
      payload: {
        name: 'Test Crawl Job',
        targetUrl: 'https://example.com/test',
        strategy: 'CHEERIO',
        maxDepth: 1,
        maxPages: 3,
        priority: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.targetUrl).toBe('https://example.com/test');
    expect(body.data.status).toBe('PENDING');

    const jobId = body.data.id;

    // Test GET /api/v1/jobs/:id
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${jobId}`,
      headers,
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.data.id).toBe(jobId);

    // Test POST /api/v1/jobs/:id/cancel
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/jobs/${jobId}/cancel`,
      headers,
    });

    expect(cancelRes.statusCode).toBe(200);
  });

  it('GET /api/v1/jobs should return paginated list of jobs', async () => {
    const headers: Record<string, string> = {};
    if (ENV.API_KEY) {
      headers['x-api-key'] = ENV.API_KEY;
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/jobs?limit=5',
      headers,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination.limit).toBe(5);
  });

  it('GET /api/v1/jobs/:id/clean-data returns 404 for an unknown job', async () => {
    const headers: Record<string, string> = {};
    if (ENV.API_KEY) headers['x-api-key'] = ENV.API_KEY;
    const res = await app.inject({ method: 'GET', url: '/api/v1/jobs/unknown-clean-data-job/clean-data', headers });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});
