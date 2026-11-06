import { describe, it, expect } from 'vitest';
import { validateUrlForSsrf, isIpPrivateOrReserved } from '../src/core/ssrf/ssrf-validator.js';

describe('SSRF Protection & URL Validation', () => {
  it('should block localhost and loopback IPv4/IPv6', async () => {
    const urls = [
      'http://localhost',
      'http://localhost:8080/admin',
      'http://127.0.0.1:3000',
      'http://127.0.0.2',
      'http://[::1]/',
      'http://0.0.0.0:80',
    ];

    for (const url of urls) {
      const res = await validateUrlForSsrf(url, false);
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    }
  });

  it('should block AWS / GCP / Azure cloud metadata IP', async () => {
    const metadataUrls = [
      'http://169.254.169.254/latest/meta-data/',
      'http://169.254.170.2/v2/metadata',
      'http://metadata.google.internal/computeMetadata/v1/',
    ];

    for (const url of metadataUrls) {
      const res = await validateUrlForSsrf(url, false);
      expect(res.valid).toBe(false);
    }
  });

  it('should block private IPv4 and IPv6 CIDRs', () => {
    expect(isIpPrivateOrReserved('10.0.0.1')).toBe(true);
    expect(isIpPrivateOrReserved('10.254.1.10')).toBe(true);
    expect(isIpPrivateOrReserved('172.16.0.5')).toBe(true);
    expect(isIpPrivateOrReserved('172.31.255.255')).toBe(true);
    expect(isIpPrivateOrReserved('192.168.1.1')).toBe(true);
    expect(isIpPrivateOrReserved('192.168.100.50')).toBe(true);
    expect(isIpPrivateOrReserved('127.0.0.1')).toBe(true);
    expect(isIpPrivateOrReserved('169.254.169.254')).toBe(true);
    expect(isIpPrivateOrReserved('::1')).toBe(true);
    expect(isIpPrivateOrReserved('fc00::1')).toBe(true);
    expect(isIpPrivateOrReserved('fe80::1')).toBe(true);

    // Public IPs should pass
    expect(isIpPrivateOrReserved('8.8.8.8')).toBe(false);
    expect(isIpPrivateOrReserved('1.1.1.1')).toBe(false);
    expect(isIpPrivateOrReserved('93.184.216.34')).toBe(false);
  });

  it('should block unauthorized protocols', async () => {
    const invalidProtocols = [
      'ftp://ftp.example.com',
      'file:///etc/passwd',
      'gopher://gopher.floodgap.com',
      'javascript:alert(1)',
      'data:text/html,<h1>Hello</h1>',
    ];

    for (const url of invalidProtocols) {
      const res = await validateUrlForSsrf(url, false);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Forbidden protocol|Invalid URL format/);
    }
  });

  it('should block URLs containing embedded user credentials', async () => {
    const res = await validateUrlForSsrf('https://admin:secret123@example.com', false);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('embedded user credentials');
  });

  it('should block reserved or internal TLDs', async () => {
    const internalDomains = [
      'http://backend.internal',
      'http://database.local',
      'http://server.lan',
      'http://intranet.corp',
    ];

    for (const url of internalDomains) {
      const res = await validateUrlForSsrf(url, false);
      expect(res.valid).toBe(false);
    }
  });

  it('should allow valid public HTTP/HTTPS URLs', async () => {
    const res = await validateUrlForSsrf('https://example.com');
    expect(res.valid).toBe(true);
    expect(res.domain).toBe('example.com');
    expect(res.normalizedUrl).toBe('https://example.com/');
  });
});
