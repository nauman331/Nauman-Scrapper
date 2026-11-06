import { config } from 'dotenv';
import { z } from 'zod';

// Load .env file
config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3200),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('file:./scrape.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Security
  API_KEY: z.string().optional().default(''),
  ALLOW_PRIVATE_NETWORKS: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),

  // Queue
  QUEUE_ADAPTER: z.enum(['memory', 'redis']).default('memory'),
  LOCAL_WORKER_PROCESSES: z.coerce.number().int().min(1).max(32).default(5),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Crawler limits & timeouts
  DEFAULT_CONCURRENCY: z.coerce.number().default(5),
  MAX_GLOBAL_CONCURRENCY: z.coerce.number().default(20),
  DEFAULT_TIMEOUT_MS: z.coerce.number().default(30000),
  MAX_REQUEST_TIMEOUT_MS: z.coerce.number().default(120000),
  MAX_CRAWL_DEPTH: z.coerce.number().default(5),
  MAX_PAGES_PER_JOB: z.coerce.number().default(100),
});

export type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', JSON.stringify(result.error.format(), null, 2));
    throw new Error('Environment configuration validation failed');
  }
  return result.data;
}

export const ENV = parseEnv();
