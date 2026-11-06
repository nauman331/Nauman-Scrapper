import { prisma } from '../prisma.js';

export class ProxyRepository {
  create(data: { name?: string; url: string }) {
    return prisma.proxy.create({ data });
  }

  /** One transaction prevents partial imports and allocates names from saved rows. */
  importNumbered(urls: string[]) {
    return prisma.$transaction(async transaction => {
      const existing = await transaction.proxy.findMany();
      const savedUrls = new Set(existing.map(proxy => proxy.url));
      let nextNumber = existing.reduce((maximum, proxy) => {
        const match = proxy.name?.match(/^proxy\s+(\d+)$/i);
        return Math.max(maximum, match ? Number(match[1]) : 0);
      }, 0);
      const imported = [];
      let skipped = 0;
      for (const url of urls) {
        if (savedUrls.has(url)) { skipped++; continue; }
        imported.push(await transaction.proxy.create({ data: { url, name: `Proxy ${++nextNumber}` } }));
        savedUrls.add(url);
      }
      return { imported, skipped };
    });
  }

  list() {
    return prisma.proxy.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findById(id: string) {
    return prisma.proxy.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<boolean> {
    const result = await prisma.proxy.deleteMany({ where: { id } });
    return result.count > 0;
  }

  updateHealth(id: string, status: 'WORKING' | 'NOT_WORKING', latencyMs: number | null) {
    return prisma.proxy.update({ where: { id }, data: { status, latencyMs, testedAt: new Date() } });
  }
}

export const proxyRepository = new ProxyRepository();
