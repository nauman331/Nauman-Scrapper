import { describe, expect, it } from 'vitest';
import { LocalWorkerPool } from '../src/queue/local-worker-pool.js';
import type { QueueJobPayload } from '../src/queue/queue.interface.js';

const job = (id: string, targetUrl = 'normal'): QueueJobPayload => ({ jobId: id, targetUrl, domain: 'test', priority: 0, retryLimit: 1 });
const fixture = new URL('./fixtures/local-worker-fixture.mjs', import.meta.url);

describe('local multi-process worker pool', () => {
  it('runs five jobs concurrently in five distinct child PIDs and drains waiting work', async () => {
    const pool = new LocalWorkerPool(5, fixture);
    await pool.start();
    try {
      const results = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => pool.execute(job(`job-${index}`), () => false)));
      const pids = results.map(result => result.status === 'rejected' ? result.reason.message : 'unexpected success');
      expect(new Set(pids).size).toBe(5);
      expect(pids.every(pid => /^pid:\d+$/.test(pid))).toBe(true);
      expect(pids).not.toContain(`pid:${process.pid}`);
      await expect(pool.execute(job('next'), () => false)).rejects.toThrow('pid:');
    } finally { await pool.close(); }
  });

  it('forwards cancellation to the process and frees its slot', async () => {
    const pool = new LocalWorkerPool(1, fixture);
    await pool.start();
    try {
      let cancelled = false;
      const active = pool.execute(job('cancel', 'cancel'), () => cancelled);
      cancelled = true;
      await active;
      await expect(pool.execute(job('next'), () => false)).rejects.toThrow('pid:');
    } finally { await pool.close(); }
  });

  it('rejects a crashed job and replaces the process for subsequent work', async () => {
    const pool = new LocalWorkerPool(1, fixture);
    await pool.start();
    try {
      await expect(pool.execute(job('crashed', 'crash'), () => false)).rejects.toThrow('Local worker exited');
      await expect(pool.execute(job('next'), () => false)).rejects.toThrow('pid:');
    } finally { await pool.close(); }
  });

  it('rejects queued work and stops active children on shutdown', async () => {
    const pool = new LocalWorkerPool(1, fixture);
    await pool.start();
    const active = pool.execute(job('active', 'cancel'), () => false).catch(error => error.message);
    const waiting = pool.execute(job('waiting'), () => false).catch(error => error.message);
    await pool.close();
    expect(await waiting).toBe('Local worker pool stopped');
    expect(await active).toContain('Local worker exited');
    await expect(pool.execute(job('late'), () => false)).rejects.toThrow('shutting down');
  });
});
