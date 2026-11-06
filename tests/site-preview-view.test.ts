import { Script, runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderPlaygroundHtml } from '../src/api/views/playground.html.js';

const html = renderPlaygroundHtml();
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

function harness() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, {
      value: '/', textContent: '', disabled: false, hidden: false, src: '', options: [],
      removeAttribute(name: string) { if (name === 'src') this.src = ''; },
      replaceChildren() { this.options = []; },
      appendChild(option: any) { this.options.push(option); if (this.options.length === 1) this.value = option.value; },
    });
    return elements.get(id);
  };
  const requests: Array<{ url: string; options: any }> = [];
  const responses: Array<any> = [];
  const timers = new Map<number, () => Promise<void>>();
  let timerId = 0;
  const context: any = {
    URL,
    window: { location: { origin: 'http://localhost:3200' } },
    document: { getElementById: element, createElement: () => ({ value: '', textContent: '' }) },
    setTimeout: (callback: () => Promise<void>) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: async (url: string, options: any) => {
      requests.push({ url, options });
      const next = responses.shift();
      if (!next) throw new Error('Unexpected request');
      return await next;
    },
  };
  runInNewContext(script.slice(script.indexOf('let sitePreviewGeneration'), script.indexOf('const HISTORY_DB_NAME')), context);
  const conversion = { id: 'conversion-1', inventory: { routes: ['/', '/about'] } };
  const record = (status: string, overrides = {}) => ({
    conversionId: conversion.id, status, logs: ['<script>alert(1)</script>'], updatedAt: new Date().toISOString(),
    ...(status === 'READY' ? { url: 'http://127.0.0.1:3300/' } : {}), ...overrides,
  });
  const respond = (data: any, status = 200) => ({ ok: status < 400, status, json: async () => status < 400 ? { success: true, data } : { success: false } });
  context.configureSitePreview(conversion);
  return { context, element, requests, responses, timers, conversion, record, respond };
}

describe('generated website runtime preview', () => {
  it('renders explicit controls, accessible status/logs, and the minimal iframe sandbox', () => {
    for (const id of ['sitePreviewPanel', 'sitePreviewStatus', 'btnStartSitePreview', 'btnStopSitePreview', 'sitePreviewRoute', 'btnRefreshSitePreview', 'sitePreviewFrame', 'sitePreviewError', 'sitePreviewLogs']) {
      expect(html).toContain('id="' + id + '"');
    }
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('referrerpolicy="no-referrer" hidden');
    expect(html).toContain('role="status" aria-live="polite">Not started');
    expect(html).not.toMatch(/sitePreviewFrame[^>]*srcdoc/);
    expect(html).toContain('id="tabScrapePreview"');
    expect(html).toContain('title="Scraped website preview" sandbox=""');
    expect(html).toContain("script-src 'none'");
    expect(html).not.toContain('allow-popups');
    expect(html).not.toContain('allow-top-navigation');
    expect(html).toContain('@media (max-width: 760px)');
  });

  it('generates syntactically valid JavaScript', () => {
    expect(script).not.toBe('');
    expect(() => new Script(script)).not.toThrow();
  });

  it('does not install automatically and uses inventory routes', () => {
    const h = harness();
    expect(h.requests).toHaveLength(0);
    expect(h.element('sitePreviewRoute').options.map((option: any) => option.value)).toEqual(['/', '/about']);
    expect(h.element('btnStartSitePreview').disabled).toBe(false);
    expect(h.element('btnStopSitePreview').disabled).toBe(true);
    expect(h.element('sitePreviewFrame').src).toBe('');
  });

  it('starts with authenticated POST, polls work only, and renders READY on another origin', async () => {
    const h = harness();
    h.responses.push(h.respond(h.record('INSTALLING')));
    await h.context.startSitePreview();
    expect(h.requests[0].url).toBe('/api/v1/conversions/conversion-1/preview');
    expect(h.requests[0].options.method).toBe('POST');
    expect(h.requests[0].options.headers['x-api-key']).toBeTruthy();
    expect(h.element('btnStartSitePreview').disabled).toBe(true);
    expect(h.element('btnStopSitePreview').disabled).toBe(false);
    for (const status of ['BUILDING', 'STARTING', 'READY']) {
      h.responses.push(h.respond(h.record(status)));
      const [id, callback] = Array.from(h.timers.entries())[0];
      h.timers.delete(id);
      await callback();
    }
    expect(h.requests.slice(1).every(request => request.options.method === 'GET')).toBe(true);
    expect(h.timers.size).toBe(0);
    expect(h.element('sitePreviewFrame').src).toBe('http://127.0.0.1:3300/');
    expect(h.element('sitePreviewFrame').src).not.toContain(h.requests[0].options.headers['x-api-key']);
    h.element('sitePreviewRoute').value = '/about';
    h.context.refreshSitePreview();
    expect(h.element('sitePreviewFrame').src).toBe('http://127.0.0.1:3300/about');
    expect(h.element('sitePreviewLogs').textContent).toBe('<script>alert(1)</script>');
  });

  it('stops work with DELETE, detaches the frame, and allows restart', async () => {
    const h = harness();
    h.context.applySitePreviewRecord(h.record('BUILDING'));
    h.responses.push(h.respond(h.record('STOPPED')));
    await h.context.stopSitePreview();
    expect(h.requests[0].options.method).toBe('DELETE');
    expect(h.element('sitePreviewFrame').hidden).toBe(true);
    expect(h.element('btnStartSitePreview').disabled).toBe(false);
    expect(h.timers.size).toBe(0);
    h.context.applySitePreviewRecord(h.record('FAILED', { errorMessage: '<img onerror=alert(1)>' }));
    expect(h.element('sitePreviewError').textContent).toBe('<img onerror=alert(1)>');
    expect(h.element('btnStartSitePreview').disabled).toBe(false);
  });

  it.each([401, 404])('stops polling and clears the preview on HTTP %s', async (status) => {
    const h = harness();
    h.responses.push(h.respond(h.record('STARTING')));
    await h.context.startSitePreview();
    h.responses.push(h.respond(null, status));
    const [id, callback] = Array.from(h.timers.entries())[0];
    h.timers.delete(id);
    await callback();
    expect(h.timers.size).toBe(0);
    expect(h.element('sitePreviewFrame').src).toBe('');
    expect(h.element('btnStartSitePreview').disabled).toBe(true);
    expect(h.element('sitePreviewError').textContent).toContain(String(status));
  });

  it('shows busy errors without polling or attaching an iframe', async () => {
    const h = harness();
    h.responses.push(h.respond(null, 409));
    await h.context.startSitePreview();
    expect(h.element('sitePreviewError').textContent).toContain('Another preview is active');
    expect(h.element('btnStartSitePreview').disabled).toBe(false);
    expect(h.timers.size).toBe(0);
  });

  it('rejects unsafe origins and routes without exposing API credentials', () => {
    const h = harness();
    for (const base of ['http://localhost:3200/', 'https://localhost:3300/', 'http://example.com:3300/', 'javascript:alert(1)', 'http://localhost/', 'http://user:pass@localhost:3300/', 'http://localhost:3300/?api_key=secret']) {
      expect(() => h.context.getSitePreviewUrl(base, '/')).toThrow();
    }
    for (const route of ['//example.com/', '/\\example.com', 'https://example.com', '/?api_key=secret']) {
      expect(() => h.context.getSitePreviewUrl('http://localhost:3300/', route)).toThrow();
    }
    expect(h.context.getSitePreviewUrl('http://[::1]:3300/', '/about')).toBe('http://[::1]:3300/about');
  });

  it('ignores responses after switching conversions and detaches an old READY iframe', async () => {
    const h = harness();
    let resolve: (response: any) => void = () => {};
    h.responses.push(new Promise(response => { resolve = response; }));
    const pending = h.context.startSitePreview();
    h.context.configureSitePreview({ id: 'conversion-2', inventory: { routes: ['/new'] } });
    resolve(h.respond(h.record('READY')));
    await pending;
    expect(h.element('sitePreviewStatus').textContent).toBe('Not started');
    expect(h.element('sitePreviewFrame').src).toBe('');
    expect(h.timers.size).toBe(0);
    h.context.applySitePreviewRecord(h.record('READY', { conversionId: 'conversion-2' }));
    expect(h.element('sitePreviewFrame').hidden).toBe(false);
    h.context.resetSitePreview();
    expect(h.element('sitePreviewFrame').src).toBe('');
    expect(h.element('sitePreviewFrame').hidden).toBe(true);
  });
});
