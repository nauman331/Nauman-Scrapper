import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import { connectDatabase, disconnectDatabase, prisma } from '../src/persistence/prisma.js';
import { jobRepository } from '../src/persistence/repositories/job.repository.js';
import { resultRepository } from '../src/persistence/repositories/result.repository.js';
import { conversionStorage } from '../src/generator/storage.js';
import { ENV } from '../src/config/env.js';

describe('Conversion REST API Endpoints', () => {
  let app: FastifyInstance;
  let testJobId: string;
  let testConversionId: string;
  const apiKeyHeaders = ENV.API_KEY ? { 'x-api-key': ENV.API_KEY } : {};

  beforeAll(async () => {
    await connectDatabase();
    app = await buildServer();
    await app.ready();

    // Seed a test scrape job with 2 pages
    const job = await jobRepository.createJob({
      name: 'Integration Test Site',
      targetUrl: 'https://example.com/',
      domain: 'example.com',
      strategy: 'AUTO',
      priority: 0,
      maxDepth: 1,
      maxPages: 5,
      requestTimeoutMs: 10000,
      retryLimit: 1,
      extractionConfig: '{}',
    });
    testJobId = job.id;

    const homeHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>Example Home</title>
          <meta name="description" content="Homepage of Example.com">
          <style>body { background: #f0f0f0; }</style>
        </head>
        <body>
          <header class="navbar">
            <a href="/" class="brand">Example</a>
            <nav><a href="/about.html">About</a></nav>
          </header>
          <main>
            <section class="hero">
              <h1>Welcome to Example</h1>
              <p>Cutting edge modern solutions.</p>
            </section>
          </main>
          <footer class="footer">
            <p>&copy; 2026 Example Inc</p>
          </footer>
        </body>
      </html>
    `;

    const aboutHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <title>About Us | Example</title>
          <meta name="description" content="About Example.com">
        </head>
        <body>
          <header class="navbar">
            <a href="/" class="brand">Example</a>
            <nav><a href="/about.html">About</a></nav>
          </header>
          <main>
            <section class="about-content">
              <h2>About Our Company</h2>
              <p>We build exceptional products for the world.</p>
            </section>
          </main>
          <footer class="footer">
            <p>&copy; 2026 Example Inc</p>
          </footer>
        </body>
      </html>
    `;

    // Save page 1
    const p1 = await resultRepository.saveCrawledPage({
      jobId: testJobId,
      url: 'https://example.com/',
      crawlerStrategy: 'AUTO',
    });
    await resultRepository.saveResultIdempotent({
      jobId: testJobId,
      crawledPageId: p1.id,
      url: 'https://example.com/',
      normalizedData: {
        url: 'https://example.com/',
        metadata: {
          title: 'Example Home',
          description: 'Homepage of Example.com',
          canonicalUrl: null,
          ogTitle: null,
          ogDescription: null,
          ogImage: null,
          twitterTitle: null,
          twitterDescription: null,
          favicon: null,
          language: 'en',
        },
        headings: { h1: ['Welcome to Example'], h2: [], h3: [], h4: [], h5: [], h6: [] },
        mainText: 'Welcome to Example Cutting edge modern solutions.',
        links: [],
        discoveredUrls: [],
        images: [],
        jsonLd: null,
        custom: null,
        redditPosts: null,
        nextPageUrl: null,
        html: homeHtml,
      },
      validation: { passed: true, errors: [] },
    });

    // Save page 2
    const p2 = await resultRepository.saveCrawledPage({
      jobId: testJobId,
      url: 'https://example.com/about.html',
      crawlerStrategy: 'AUTO',
    });
    await resultRepository.saveResultIdempotent({
      jobId: testJobId,
      crawledPageId: p2.id,
      url: 'https://example.com/about.html',
      normalizedData: {
        url: 'https://example.com/about.html',
        metadata: {
          title: 'About Us | Example',
          description: 'About Example.com',
          canonicalUrl: null,
          ogTitle: null,
          ogDescription: null,
          ogImage: null,
          twitterTitle: null,
          twitterDescription: null,
          favicon: null,
          language: 'en',
        },
        headings: { h1: [], h2: ['About Our Company'], h3: [], h4: [], h5: [], h6: [] },
        mainText: 'About Our Company We build exceptional products for the world.',
        links: [],
        discoveredUrls: [],
        images: [],
        jsonLd: null,
        custom: null,
        redditPosts: null,
        nextPageUrl: null,
        html: aboutHtml,
      },
      validation: { passed: true, errors: [] },
    });
  });

  afterAll(async () => {
    if (testConversionId) {
      await conversionStorage.deleteConversion(testConversionId);
    }
    if (testJobId) {
      await prisma.scrapeJob.delete({ where: { id: testJobId } }).catch(() => {});
    }
    await app.close();
    await disconnectDatabase();
  });

  it('GET /api/v1/jobs/:jobId/conversion-preview returns page inventory and proposed routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/jobs/${testJobId}/conversion-preview`,
      headers: apiKeyHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.pages).toHaveLength(2);
    expect(body.data.routes).toContain('/');
    expect(body.data.routes).toContain('/about');
  });

  it('POST /api/v1/conversions starts Next.js generation pipeline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/conversions',
      headers: apiKeyHeaders,
      payload: {
        jobId: testJobId,
        options: {
          projectName: 'test-example-site',
          cssStrategy: 'original',
          componentExtraction: 'standard',
        },
      },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeDefined();
    expect(body.data.stages).toHaveLength(11);
    testConversionId = body.data.id;
  });

  it('GET /api/v1/conversions/:id returns progress until completed', async () => {
    let completed = false;
    let body: any = null;

    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/conversions/${testConversionId}`,
        headers: apiKeyHeaders,
      });

      expect(res.statusCode).toBe(200);
      body = JSON.parse(res.body);
      if (body.data.status === 'COMPLETED' || body.data.status === 'FAILED') {
        completed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(completed).toBe(true);
    expect(body.data.status).toBe('COMPLETED');
    expect(body.data.validationReport.passed).toBe(true);
    expect(body.data.totalFilesGenerated).toBeGreaterThan(5);
    expect(body.data.zipSizeBytes).toBeGreaterThan(0);
    expect(body.data.fileTree).toBeDefined();
  });

  it('GET /api/v1/conversions/:id/files/* allows reading generated files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversions/${testConversionId}/files/src/app/page.tsx`,
      headers: apiKeyHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.content).toContain('export default function');
    expect(body.data.content).toContain('metadata');
  });

  it('GET /api/v1/conversions/:id/download streams valid ZIP archive with x-api-key header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversions/${testConversionId}/download`,
      headers: apiKeyHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment; filename="test-example-site.zip"');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/conversions/:id/download rejects when API key is missing', async () => {
    if (ENV.API_KEY) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/conversions/${testConversionId}/download`,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('GET /api/v1/conversions/:id/download streams valid ZIP archive using ?api_key= query parameter', async () => {
    if (ENV.API_KEY) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/conversions/${testConversionId}/download?api_key=${ENV.API_KEY}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toContain('attachment; filename="test-example-site.zip"');
      expect(res.rawPayload.length).toBeGreaterThan(0);
    }
  });
});
