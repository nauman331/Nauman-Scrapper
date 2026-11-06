import { PrismaClient } from '@prisma/client';
import { logger } from '../monitoring/logger.js';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__prisma ||
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

// Log queries if in debug mode
// @ts-expect-error Prisma event typing
prisma.$on('error', (e: unknown) => {
  logger.error({ error: e }, 'Prisma database error');
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to the database');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting from the database');
  }
}
