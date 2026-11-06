import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { BulkProxyImportSchema, CreateProxySchema } from '../src/proxies/proxy.types.js';
import { proxyService } from '../src/proxies/proxy.service.js';
import { proxyRepository } from '../src/persistence/repositories/proxy.repository.js';
import { proxyRoutes } from '../src/api/routes/proxy.routes.js';
import { prisma } from '../src/persistence/prisma.js';

const row = { id: 'cjld2cjxh0000qzrmn831i7rn', name: 'Proxy 1', url: 'http://user:password@proxy.example:8080/', status: 'UNTESTED', latencyMs: null, testedAt: null, createdAt: new Date(), updatedAt: new Date() };
afterEach(() => vi.restoreAllMocks());
describe('bulk proxy import', () => {
  it('accepts provider format, encodes credentials and retains full URLs', () => {
    expect(CreateProxySchema.parse({ url: 'proxy.example:8080:user:pass:word@' }).url).toBe('http://user:pass%3Aword%40@proxy.example:8080/');
    expect(CreateProxySchema.parse({ url: 'socks5://user:password@proxy.example:8080' }).url).toContain('socks5:');
  });
  it('reports invalid line numbers without reflecting credentials and enforces batch limits', () => {
    const result = BulkProxyImportSchema.safeParse({ proxies: 'proxy.example:8080:user:password\nsecret-bad-entry' });
    expect(result.success).toBe(false);
    if (!result.success) { expect(result.error.message).toContain('line 2'); expect(result.error.message).not.toContain('secret-bad-entry'); }
    expect(BulkProxyImportSchema.safeParse({ proxies: Array(501).fill('proxy.example:8080:user:password').join('\n') }).success).toBe(false);
  });
  it('returns masked imported proxies and duplicate counts', async () => {
    const save = vi.spyOn(proxyRepository, 'importNumbered').mockResolvedValue({ imported: [row], skipped: 1 });
    const result = await proxyService.importBulk({ proxies: 'proxy.example:8080:user:password\nproxy.example:8080:user:password' });
    expect(save).toHaveBeenCalledWith([row.url, row.url]);
    expect(result.importedCount).toBe(1); expect(result.skippedCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain('password');
  });
  it('validates all lines before writing any proxies', async () => {
    const save = vi.spyOn(proxyRepository, 'importNumbered');
    await expect(proxyService.importBulk({ proxies: 'proxy.example:8080:user:password\ninvalid' })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
  it('continues numbering and skips existing and within-batch duplicate URLs atomically', async () => {
    const create = vi.fn().mockImplementation(async ({ data }) => ({ ...row, ...data }));
    const transaction = { proxy: { findMany: vi.fn().mockResolvedValue([{ ...row, name: 'Proxy 4' }]), create } };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(transaction));
    const result = await proxyRepository.importNumbered([row.url, 'http://other.example:8080/', 'http://other.example:8080/', 'http://third.example:8080/']);
    expect(create.mock.calls.map(([arg]) => arg.data.name)).toEqual(['Proxy 5', 'Proxy 6']);
    expect(result.skipped).toBe(2);
  });
  it('supports import through the REST endpoint', async () => {
    const app = Fastify();
    vi.spyOn(proxyService, 'importBulk').mockResolvedValue({ imported: [], importedCount: 0, skippedCount: 1 });
    await app.register(proxyRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/proxies/import', payload: { proxies: 'proxy.example:8080:user:password' } });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.skippedCount).toBe(1);
    } finally { await app.close(); }
  });
});
