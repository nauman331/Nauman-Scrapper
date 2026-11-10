import fs from 'node:fs/promises';
import path from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { describe, expect, it } from 'vitest';

// Real assets and saved rendered HTML; no browser, synthetic CSS, or fidelity assertions.
// PowerShell (set NODE_OPTIONS only for this invocation and restore it afterwards):
// $env:VERIFY_HSPROPERTY_MEMORY='1'; $env:HSPROPERTY_SNAPSHOT='storage/conversions/<id>/source.html'
// $env:NODE_OPTIONS='--max-old-space-size=1024'; npx vitest run tests/hsproperty-memory.test.ts --maxWorkers=1
// Do not enable VERIFY_HSPROPERTY_LIVE: that separate Core CSS test checks source fonts.
const enabled = process.env.VERIFY_HSPROPERTY_MEMORY === '1';
const mib = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(2));

describe.skipIf(!enabled)('H&S strict Tailwind bounded-memory regression', () => {
  it('completes a real saved-snapshot Tailwind export within the bounded heap', async () => {
    const snapshot = process.env.HSPROPERTY_SNAPSHOT;
    expect(snapshot, 'Set HSPROPERTY_SNAPSHOT to a saved rendered source.html').toBeTruthy();
    expect(process.env.NODE_OPTIONS, 'Run with NODE_OPTIONS=--max-old-space-size=1024').toMatch(/(?:^|\s)--max-old-space-size=1024(?:\s|$)/);
    // V8 total heap also includes young-generation space (Node 26 reports 1216 MiB).
    expect(getHeapStatistics().heap_size_limit, 'Worker must inherit the bounded V8 heap').toBeLessThanOrEqual(1280 * 1024 * 1024);

    const samples: Array<{ stage: string; elapsedMs: number; heapUsedMiB: number; heapTotalMiB: number; rssMiB: number; externalMiB: number; arrayBuffersMiB: number }> = [];
    const started = performance.now();
    let stage = 'load-snapshot';
    let peakHeap = 0;
    let peakRss = 0;
    const stageSampledPeakHeapMiB: Record<string, number> = {};
    const sample = (log = false) => {
      const memory = process.memoryUsage();
      peakHeap = Math.max(peakHeap, memory.heapUsed);
      peakRss = Math.max(peakRss, memory.rss);
      stageSampledPeakHeapMiB[stage] = Math.max(stageSampledPeakHeapMiB[stage] ?? 0, mib(memory.heapUsed));
      const entry = { stage, elapsedMs: Math.round(performance.now() - started), heapUsedMiB: mib(memory.heapUsed), heapTotalMiB: mib(memory.heapTotal), rssMiB: mib(memory.rss), externalMiB: mib(memory.external), arrayBuffersMiB: mib(memory.arrayBuffers) };
      if (log) {
        samples.push(entry);
        process.stdout.write(`[H&S memory] ${JSON.stringify(entry)}\n`);
      }
    };
    sample(true);
    // Timer observes asynchronous asset resolution; synchronous conversion blocks it.
    // Report a sampled peak, not a claimed exact intra-stage V8 high-water mark.
    const timer = setInterval(() => sample(), 100);
    timer.unref();
    let conversionId: string | undefined;
    let storage: typeof import('../src/generator/storage.js')['conversionStorage'] | undefined;
    let outcome: Record<string, unknown> | undefined;
    try {
      const html = await fs.readFile(path.resolve(snapshot!), 'utf8');
      expect(html).toContain('H&S');
      stage = 'import-exporter';
      sample(true);
      const { exportStandaloneHtml, TAILWIND_BROWSER_URL } = await import('../src/generator/html-exporter.js');
      const { HtmlConversionOptionsSchema } = await import('../src/generator/html-types.js');
      ({ conversionStorage: storage } = await import('../src/generator/storage.js'));
      // Unique workspace: never overwrite or delete the saved/Core live artifacts.
      conversionId = `hsproperty_memory_${Date.now()}_${process.pid}`;
      stage = 'start-export';
      sample(true);
      process.stdout.write(`[H&S memory] snapshot=${path.resolve(snapshot!)} bytes=${Buffer.byteLength(html)} assets=real-network artifact=${storage.getConversionDir(conversionId)}\n`);
      try {
        const result = await exportStandaloneHtml({
          conversionId,
          jobId: 'hsproperty-memory-regression',
          targetUrl: 'https://hsproperty.ae/',
          domain: 'hsproperty.ae',
          pages: [{ url: 'https://hsproperty.ae/', rawData: { html } }],
          options: HtmlConversionOptionsSchema.parse({ cssStrategy: 'tailwind', downloadAssets: true }),
          stage: (id, message) => {
            stage = id;
            sample(true);
            process.stdout.write(`[H&S stage] ${message}\n`);
          },
        });
        stage = 'validate-export';
        sample(true);
        const output = await storage.readFileSafe(conversionId, 'index.html');
        expect(output).toBeTruthy();
        expect(output).toContain(TAILWIND_BROWSER_URL);
        expect(output).not.toMatch(/<style\b|\sstyle\s*=/i);
        const preview = JSON.parse(await fs.readFile(path.join(storage.getConversionDir(conversionId), 'tailwind-preview.json'), 'utf8')) as Record<string, string>;
        expect(preview['index.html']?.length).toBeGreaterThan(0);
        expect(result.conversionStats.declarationsConverted).toBeGreaterThan(0);
        expect(result.missingAssets, 'Real-network verification must not silently accept missing assets').toEqual([]);
        outcome = { status: 'exported', result, outputBytes: Buffer.byteLength(output!) };
      } catch (error) {
        // Connectivity, fidelity assertions and arbitrary exceptions are NOT budget successes.
        if (!(error instanceof Error) || !['TailwindBudgetError', 'CssBudgetExceededError'].includes(error.name)) throw error;
        expect(error.message).toMatch(/budget/i);
        expect(error.message).toMatch(/Use Core CSS export|Reduce stylesheet\/import size/);
        outcome = { status: 'budget-rejected', name: error.name, message: error.message, failedStage: stage };
        process.stdout.write(`[H&S outcome] ${error.name}: ${error.message}\n`);
        // This fixture must complete; a graceful rejection is no longer a success.
        throw error;
      }
    } finally {
      clearInterval(timer);
      stage = 'finished';
      sample(true);
      const report = { snapshot: snapshot && path.resolve(snapshot), conversionId, outcome: outcome ?? { status: 'failed' }, heapLimitMiB: mib(getHeapStatistics().heap_size_limit), sampledPeakHeapMiB: mib(peakHeap), stageSampledPeakHeapMiB, sampledPeakRssMiB: mib(peakRss), processMaxRssMiB: mib(process.resourceUsage().maxRSS * 1024), peakNote: 'process.memoryUsage at stage boundaries and 100ms async samples; synchronous intra-stage peaks may be higher', samples };
      process.stdout.write(`[H&S report] ${JSON.stringify(report)}\n`);
      if (conversionId && storage) await fs.writeFile(path.join(storage.getConversionDir(conversionId), 'memory-result.json'), JSON.stringify(report, null, 2));
    }
  }, 900000);
});
