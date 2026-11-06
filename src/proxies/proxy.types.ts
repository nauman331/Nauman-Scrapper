import { z } from 'zod';

export function parseProxyAddress(value: string): string {
  const input = value.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return input;
  const match = input.match(/^([^:\s]+):(\d+):([^:\s]+):(.+)$/);
  if (!match) throw new Error('Use host:port:username:password or a full proxy URL.');
  const url = new URL(`http://${match[1]}:${match[2]}`);
  url.username = match[3];
  url.password = match[4];
  return url.href;
}

const ProxyUrlSchema = z.string().trim().min(1).transform((value, ctx) => {
  try { return parseProxyAddress(value); }
  catch { ctx.addIssue({ code: 'custom', message: 'Use host:port:username:password or a valid proxy URL.' }); return z.NEVER; }
}).superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(url.protocol)) {
      ctx.addIssue({ code: 'custom', message: 'Proxy URL must use http, https, socks, socks4, or socks5' });
    }
    if (!url.hostname || !url.port) {
      ctx.addIssue({ code: 'custom', message: 'Proxy URL must include a host and port' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Proxy URL is invalid' });
  }
});

export const CreateProxySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: ProxyUrlSchema,
});

export const BulkProxyImportSchema = z.object({
  proxies: z.string().trim().min(1).max(200000),
}).superRefine((input, ctx) => {
  const lines = input.proxies.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 500) ctx.addIssue({ code: 'custom', path: ['proxies'], message: 'Import at most 500 proxies at a time.' });
  lines.forEach((line, index) => {
    if (!ProxyUrlSchema.safeParse(line).success) ctx.addIssue({ code: 'custom', path: ['proxies'], message: `Invalid proxy on line ${index + 1}. Use host:port:username:password or a full proxy URL.` });
  });
});
export type BulkProxyImportInput = z.infer<typeof BulkProxyImportSchema>;

export const ProxyIdParamsSchema = z.object({ id: z.string().cuid() });
export type CreateProxyInput = z.infer<typeof CreateProxySchema>;
