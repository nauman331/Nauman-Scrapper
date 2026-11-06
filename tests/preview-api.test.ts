import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import { conversionService } from '../src/generator/conversion.service.js';
import { sitePreviewService, PreviewBusyError } from '../src/generator/preview.service.js';
import { ENV } from '../src/config/env.js';

const headers = ENV.API_KEY ? { 'x-api-key': ENV.API_KEY } : {};
const preview = { conversionId: 'conv_test', status: 'INSTALLING' as const, logs: [], updatedAt: '2026-11-04' };
describe('Authenticated built-site preview endpoints', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildServer(); await app.ready(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app.close(); });
  it('starts only completed validated conversions', async () => {
    vi.spyOn(conversionService, 'getConversion').mockReturnValue({ status: 'COMPLETED', validationReport: { passed: true } } as never);
    const start = vi.spyOn(sitePreviewService, 'start').mockReturnValue(preview);
    const response = await app.inject({ method: 'POST', url: '/api/v1/conversions/conv_test/preview', headers });
    expect(response.statusCode).toBe(202);
    expect(start).toHaveBeenCalledWith('conv_test');
    expect(response.json().data.status).toBe('INSTALLING');
  });
  it('rejects missing and incomplete conversions', async () => {
    const start = vi.spyOn(sitePreviewService, 'start');
    vi.spyOn(conversionService, 'getConversion').mockReturnValue(null);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversions/missing/preview', headers })).statusCode).toBe(404);
    vi.spyOn(conversionService, 'getConversion').mockReturnValue({ status: 'FAILED' } as never);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversions/failed/preview', headers })).statusCode).toBe(409);
    expect(start).not.toHaveBeenCalled();
  });
  it('reports occupied runtime as conflict', async () => {
    vi.spyOn(conversionService, 'getConversion').mockReturnValue({ status: 'COMPLETED', validationReport: { passed: true } } as never);
    vi.spyOn(sitePreviewService, 'start').mockImplementation(() => { throw new PreviewBusyError('Stop other preview'); });
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversions/conv_test/preview', headers })).statusCode).toBe(409);
  });
  it('returns status and stops the runtime', async () => {
    vi.spyOn(sitePreviewService, 'get').mockReturnValue(preview);
    expect((await app.inject({ method: 'GET', url: '/api/v1/conversions/conv_test/preview', headers })).json().data.conversionId).toBe('conv_test');
    vi.spyOn(sitePreviewService, 'stop').mockResolvedValue({ ...preview, status: 'STOPPED' });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/conversions/conv_test/preview', headers })).json().data.status).toBe('STOPPED');
  });
  it('requires the configured API key', async () => {
    if (!ENV.API_KEY) return;
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversions/conv_test/preview' })).statusCode).toBe(401);
  });
});
