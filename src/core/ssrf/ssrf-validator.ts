import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import ipaddr from 'ipaddr.js';
import { ENV } from '../../config/env.js';
import { logger } from '../../monitoring/logger.js';

export interface ValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  domain?: string;
  resolvedIps?: string[];
  error?: string;
}

const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const FORBIDDEN_TLDS = ['.local', '.internal', '.lan', '.corp', '.home', '.test', '.example', '.invalid'];

/**
 * Validates a target URL against SSRF vulnerabilities:
 * - Scheme must be http or https
 * - Prevents credentials in URL (user:pass@)
 * - Checks against localhost and known metadata endpoints
 * - Resolves DNS and inspects all returned IPv4 and IPv6 addresses against private/reserved CIDRs
 */
export async function validateUrlForSsrf(
  urlString: string,
  allowPrivate = ENV.ALLOW_PRIVATE_NETWORKS
): Promise<ValidationResult> {
  try {
    let parsed: URL;
    try {
      parsed = new URL(urlString.trim());
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }

    // Protocol check
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: `Forbidden protocol: '${parsed.protocol}'. Only 'http:' and 'https:' are permitted.`,
      };
    }

    // Reject credentials in URL
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        error: 'URLs containing embedded user credentials (user:password@) are not allowed.',
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check forbidden hostnames
    if (FORBIDDEN_HOSTNAMES.has(hostname)) {
      return {
        valid: false,
        error: `Host '${hostname}' is an internal or loopback address and cannot be crawled.`,
      };
    }

    // Check forbidden TLDs
    if (FORBIDDEN_TLDS.some((tld) => hostname.endsWith(tld))) {
      return {
        valid: false,
        error: `Host '${hostname}' belongs to a reserved or local TLD and cannot be crawled.`,
      };
    }

    // If allowPrivate is explicitly true (e.g. testing in private network), bypass IP check
    if (allowPrivate) {
      return {
        valid: true,
        normalizedUrl: parsed.toString(),
        domain: hostname,
        resolvedIps: [],
      };
    }

    // Check if hostname is an explicit IP address
    if (ipaddr.isValid(hostname)) {
      const isPrivateOrReserved = isIpPrivateOrReserved(hostname);
      if (isPrivateOrReserved) {
        return {
          valid: false,
          error: `IP address '${hostname}' is private, reserved, or belongs to cloud metadata.`,
        };
      }

      return {
        valid: true,
        normalizedUrl: parsed.toString(),
        domain: hostname,
        resolvedIps: [hostname],
      };
    }

    // Resolve DNS to obtain all IPv4 and IPv6 addresses
    let addresses: LookupAddress[];
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch (dnsErr: unknown) {
      const msg = dnsErr instanceof Error ? dnsErr.message : String(dnsErr);
      return {
        valid: false,
        error: `DNS resolution failed for host '${hostname}': ${msg}`,
      };
    }

    if (!addresses || addresses.length === 0) {
      return {
        valid: false,
        error: `No IP addresses found for host '${hostname}'`,
      };
    }

    const resolvedIps: string[] = [];

    for (const record of addresses) {
      const ip = record.address;
      resolvedIps.push(ip);

      if (isIpPrivateOrReserved(ip)) {
        logger.warn({ hostname, ip }, 'SSRF prevention blocked target domain resolving to private/reserved IP');
        return {
          valid: false,
          error: `Domain '${hostname}' resolves to private/reserved IP address '${ip}'. Request blocked for security.`,
          resolvedIps,
        };
      }
    }

    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      domain: hostname,
      resolvedIps,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `SSRF validation error: ${error}` };
  }
}

/**
 * Checks if an IP is private, loopback, link-local, carrier NAT, multicast, or cloud metadata
 */
export function isIpPrivateOrReserved(ipString: string): boolean {
  try {
    const addr = ipaddr.parse(ipString);
    const range = addr.range();

    // Specific cloud metadata check: 169.254.169.254 (AWS, GCP, Azure, DigitalOcean)
    if (ipString === '169.254.169.254' || ipString === '169.254.170.2') {
      return true;
    }

    // IPv4 ranges:
    // loopback (127.0.0.0/8), private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    // linkLocal (169.254.0.0/16), carrierGradeNat (100.64.0.0/10)
    // broadcast (255.255.255.255), reserved (240.0.0.0/4), unspecified (0.0.0.0)
    // IPv6 ranges:
    // loopback (::1), uniqueLocal (fc00::/7), linkLocal (fe80::/10)
    // multicast (ff00::/8), unspecified (::)
    const dangerousRanges = [
      'loopback',
      'private',
      'linkLocal',
      'carrierGradeNat',
      'broadcast',
      'reserved',
      'unspecified',
      'uniqueLocal',
      'multicast',
    ];

    if (dangerousRanges.includes(range)) {
      return true;
    }

    // Also check if mapped IPv4 (e.g. ::ffff:127.0.0.1)
    if (addr.kind() === 'ipv6') {
      const ipv6 = addr as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        const ipv4 = ipv6.toIPv4Address();
        return dangerousRanges.includes(ipv4.range());
      }
    }

    return false;
  } catch {
    return true; // If we cannot parse it safely, consider it forbidden
  }
}
