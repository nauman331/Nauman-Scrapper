import { describe, expect, it, vi } from 'vitest';
import { createBoundedEnqueue } from '../src/crawlers/bounded-request-queue.js';

describe('strict crawler queue page budget', () => {
  it('includes the root and never admits more than 50 under parallel discovery', async () => {
    const urls = new Set<string>();
    const queue = { addRequest: vi.fn(async ({ url }: { url: string }) => {
      await Promise.resolve();
      const wasAlreadyPresent = urls.has(url); urls.add(url);
      return { wasAlreadyPresent };
    }) };
    const enqueue = createBoundedEnqueue(queue, 50);
    await enqueue('https://site.test/', 0);
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => enqueue('https://site.test/page-' + index, 1)));
    expect(urls.size).toBe(50);
    expect(results.filter(Boolean)).toHaveLength(49);
    expect(queue.addRequest).toHaveBeenCalledTimes(50);
  });
  it('does not spend budget on duplicate discoveries', async () => {
    const urls = new Set<string>();
    const enqueue = createBoundedEnqueue({ addRequest: async ({ url }) => {
      const wasAlreadyPresent = urls.has(url); urls.add(url); return { wasAlreadyPresent };
    } }, 2);
    await Promise.all([enqueue('https://site.test/', 0), enqueue('https://site.test/', 1)]);
    expect(await enqueue('https://site.test/about', 1)).toBe(true);
    expect(await enqueue('https://site.test/contact', 1)).toBe(false);
    expect(urls.size).toBe(2);
  });
  it('recovers admission serialization after a queue write fails', async () => {
    const addRequest = vi.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValue({ wasAlreadyPresent: false });
    const enqueue = createBoundedEnqueue({ addRequest }, 1);
    await expect(enqueue('https://site.test/', 0)).rejects.toThrow('Storage unavailable');
    expect(await enqueue('https://site.test/', 0)).toBe(true);
    expect(await enqueue('https://site.test/about', 1)).toBe(false);
  });
});
