import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ENV } from '../../config/env.js';

import { DASHBOARD_ROUTES } from '../views/dashboard-routes.js';

// Section URLs serve the same dashboard shell as '/'; API guards remain unchanged.
const PUBLIC_PATHS = new Set<string>(['/', '/docs', '/health', '/ready', '/favicon.ico', ...Object.values(DASHBOARD_ROUTES)]);

const authPluginCallback: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public health/readiness endpoints
    if (PUBLIC_PATHS.has(request.url.split('?')[0])) {
      return;
    }

    // Preview URLs carry a short-lived, conversion-scoped capability, never the API key.
    // The preview route validates the token and confines access to generated static files.
    if (/^\/api(?:\/v1)?\/html-preview\/[a-f0-9]{64}\//.test(request.url.split('?')[0])) {
      return;
    }

    // Exact preview capabilities are separately validated by the exact-only route.
    if (/^\/api(?:\/v1)?\/exact-preview\/[a-f0-9]{64}\//.test(request.url.split('?')[0])) {
      return;
    }

    // If API_KEY is not configured, allow requests (useful in open local dev)
    if (!ENV.API_KEY || ENV.API_KEY.trim() === '') {
      return;
    }

    const authHeader = request.headers.authorization;
    const apiKeyHeader = request.headers['x-api-key'];

    let providedKey = '';

    if (typeof apiKeyHeader === 'string') {
      providedKey = apiKeyHeader.trim();
    } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      providedKey = authHeader.substring(7).trim();
    }

    // Support query parameters (e.g. for browser file downloads, SSE, or direct links)
    if (!providedKey) {
      try {
        const parsedUrl = new URL(request.url, 'http://localhost');
        const queryKey =
          parsedUrl.searchParams.get('api_key') ||
          parsedUrl.searchParams.get('apiKey') ||
          parsedUrl.searchParams.get('token') ||
          parsedUrl.searchParams.get('x-api-key');
        if (queryKey) {
          providedKey = queryKey.trim();
        }
      } catch {
        // Ignore URL parsing errors
      }
    }

    if (!providedKey) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing API key. Provide via x-api-key header, Bearer authorization, or api_key query parameter.',
        },
      });
    }

    // Timing-safe comparison to prevent timing attacks
    const expectedBuffer = Buffer.from(ENV.API_KEY);
    const providedBuffer = Buffer.from(providedKey);

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return reply.code(401).send({
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Provided API key is invalid.',
        },
      });
    }
  });
};

export const authPlugin = fp(authPluginCallback, {
  name: 'auth-plugin',
});
