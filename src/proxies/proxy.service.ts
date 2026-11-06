import { fetchProxyAsset } from './proxy-fetch.js';
import { BulkProxyImportSchema, CreateProxySchema, type BulkProxyImportInput, type CreateProxyInput, parseProxyAddress } from './proxy.types.js';
import { proxyRepository } from '../persistence/repositories/proxy.repository.js';

export interface PublicProxy {
  id: string;
  name: string | null;
  displayUrl: string;
  status: string;
  latencyMs: number | null;
  testedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeProxyUrl(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function maskProxyUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) {
    url.username = '***';
    url.password = '***';
  }
  return url.toString();
}

function toPublic(proxy: { id: string; name: string | null; url: string; status: string; latencyMs: number | null; testedAt: Date | null; createdAt: Date; updatedAt: Date }): PublicProxy {
  return { id: proxy.id, name: proxy.name, displayUrl: maskProxyUrl(proxy.url), status: proxy.status, latencyMs: proxy.latencyMs, testedAt: proxy.testedAt, createdAt: proxy.createdAt, updatedAt: proxy.updatedAt };
}

export class ProxyService {
  async create(input: CreateProxyInput): Promise<PublicProxy> {
    const parsed = CreateProxySchema.parse(input);
    const url = normalizeProxyUrl(parsed.url);
    if (parsed.name) return toPublic(await proxyRepository.create({ name: parsed.name, url }));
    const result = await proxyRepository.importNumbered([url]);
    if (result.imported[0]) return toPublic(result.imported[0]);
    throw Object.assign(new Error('This proxy is already saved.'), { statusCode: 409 });
  }

  async importBulk(input: BulkProxyImportInput) {
    const parsed = BulkProxyImportSchema.parse(input);
    const urls = parsed.proxies.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => normalizeProxyUrl(parseProxyAddress(line)));
    const result = await proxyRepository.importNumbered(urls);
    return { imported: result.imported.map(toPublic), importedCount: result.imported.length, skippedCount: result.skipped };
  }

  async list(): Promise<PublicProxy[]> {
    return (await proxyRepository.list()).map(toPublic);
  }

  delete(id: string): Promise<boolean> {
    return proxyRepository.delete(id);
  }

  async resolveUrl(id: string): Promise<string | null> {
    return (await proxyRepository.findById(id))?.url ?? null;
  }

  async assertExists(id: string): Promise<void> {
    if (!(await proxyRepository.findById(id))) throw Object.assign(new Error(`Proxy '${id}' not found`), { statusCode: 400, code: 'INVALID_PROXY' });
  }

  async test(id: string): Promise<PublicProxy | null> {
    const proxy = await proxyRepository.findById(id);
    if (!proxy) return null;
    const startedAt = Date.now();
    try {
      const response = await fetchProxyAsset('https://api.ipify.org?format=json', proxy.url, { maxBytes: 65536 });
      if (!response.ok) throw new Error('Proxy health check failed');
      return toPublic(await proxyRepository.updateHealth(id, 'WORKING', Date.now() - startedAt));
    } catch {
      return toPublic(await proxyRepository.updateHealth(id, 'NOT_WORKING', Date.now() - startedAt));
    }
  }
}

export const proxyService = new ProxyService();
