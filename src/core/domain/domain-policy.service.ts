import { prisma } from '../../persistence/prisma.js';

export interface DomainSettings {
  domain: string;
  maxConcurrency: number;
  minDelayMs: number;
  allowed: boolean;
  userAgent?: string | null;
}

export class DomainPolicyService {
  private cache = new Map<string, { settings: DomainSettings; expiresAt: number }>();
  private lastRequestTimes = new Map<string, number>();
  private activeDomainRequests = new Map<string, number>();
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute cache

  /**
   * Retrieves policy for a domain, creating a default one if none exists
   */
  async getPolicy(domain: string): Promise<DomainSettings> {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
    const now = Date.now();

    const cached = this.cache.get(cleanDomain);
    if (cached && cached.expiresAt > now) {
      return cached.settings;
    }

    let policy = await prisma.domainPolicy.findUnique({
      where: { domain: cleanDomain },
    });

    if (!policy) {
      policy = await prisma.domainPolicy.upsert({
        where: { domain: cleanDomain },
        update: {},
        create: {
          domain: cleanDomain,
          maxConcurrency: 3,
          minDelayMs: 500,
          allowed: true,
        },
      });
    }

    const settings: DomainSettings = {
      domain: policy.domain,
      maxConcurrency: policy.maxConcurrency,
      minDelayMs: policy.minDelayMs,
      allowed: policy.allowed,
      userAgent: policy.userAgent,
    };

    this.cache.set(cleanDomain, {
      settings,
      expiresAt: now + this.CACHE_TTL_MS,
    });

    return settings;
  }

  /**
   * Paces requests according to minDelayMs for the domain
   */
  async paceRequest(domain: string, minDelayMs = 500): Promise<void> {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
    const now = Date.now();
    const lastTime = this.lastRequestTimes.get(cleanDomain) || 0;
    const elapsed = now - lastTime;

    if (elapsed < minDelayMs) {
      const waitTime = minDelayMs - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTimes.set(cleanDomain, Date.now());
  }

  /**
   * Concurrency tracking for domain
   */
  acquireSlot(domain: string, maxConcurrency: number): boolean {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
    const current = this.activeDomainRequests.get(cleanDomain) || 0;

    if (current >= maxConcurrency) {
      return false;
    }

    this.activeDomainRequests.set(cleanDomain, current + 1);
    return true;
  }

  releaseSlot(domain: string): void {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, '');
    const current = this.activeDomainRequests.get(cleanDomain) || 0;
    if (current > 0) {
      this.activeDomainRequests.set(cleanDomain, current - 1);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const domainPolicyService = new DomainPolicyService();
