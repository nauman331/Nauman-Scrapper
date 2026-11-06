import { gotScraping } from 'got-scraping';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { validateUrlForSsrf } from '../core/ssrf/ssrf-validator.js';

/** Server-only proxy transport. Never falls back to a direct request on failure. */
export async function fetchThroughProxy(url: string, proxyUrl: string, options: {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxBytes?: number;
} = {}): Promise<Response> {
  const validation = await validateUrlForSsrf(url);
  if (!validation.valid) throw new Error(`Blocked proxied URL: ${validation.error || 'SSRF policy'}`);
  let agent: SocksProxyAgent | undefined;
  let stream: ReturnType<typeof gotScraping.stream> | undefined;
  // Keep credentials and proxy transport diagnostics out of public errors/logs,
  // including synchronous agent/transport initialization failures.
  try {
    const socks = /^socks(?:4|5)?:/i.test(proxyUrl);
    agent = socks ? new SocksProxyAgent(proxyUrl.replace(/^socks:/i, 'socks5:')) : undefined;
    stream = gotScraping.stream({
      url, ...(agent ? { agent: { http: agent, https: agent }, http2: false } : { proxyUrl }),
      followRedirect: false, throwHttpErrors: false,
      retry: { limit: 0 }, timeout: { request: 10000 },
      headers: options.headers, signal: options.signal,
    });
    const request = stream;
    const response = await new Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      request.once('response', resolve);
      request.once('error', reject);
    });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > (options.maxBytes ?? 10 * 1024 * 1024)) throw new Error('Proxy response exceeded size limit');
      chunks.push(buffer);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const noBody = [204, 205, 304].includes(response.statusCode);
    return new Response(noBody ? null : new Uint8Array(Buffer.concat(chunks)), { status: response.statusCode, headers });
  } catch {
    throw new Error('Proxy request failed or exceeded its limits; no direct connection was attempted.');
  } finally {
    stream?.destroy();
    agent?.destroy();
  }
}

/** Redirects remain SSRF-validated and on the same selected proxy. */
export async function fetchProxyAsset(url: string, proxyUrl: string, options: Parameters<typeof fetchThroughProxy>[2] = {}): Promise<Response> {
  let target = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchThroughProxy(target, proxyUrl, options);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === 5) throw new Error('Invalid proxy asset redirect or redirect limit exceeded');
    target = new URL(location, target).href;
  }
  throw new Error('Proxy asset redirect limit exceeded');
}
