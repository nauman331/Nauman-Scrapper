import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../../monitoring/logger.js';

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const reqId = request.id;

  // Handle Zod schema validation errors
  if (error instanceof ZodError) {
    reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request payload validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      },
      requestId: reqId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Handle Fastify 400 validation error
  if (error.validation) {
    reply.status(400).send({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: error.message,
        details: error.validation,
      },
      requestId: reqId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Handle Known HTTP status code errors
  const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;

  if (statusCode >= 500) {
    logger.error({ reqId, error: error.message, stack: error.stack }, 'Unhandled internal server error');
    reply.status(statusCode).send({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred. Please check the logs.',
      },
      requestId: reqId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  reply.status(statusCode).send({
    success: false,
    error: {
      code: error.code || 'REQUEST_ERROR',
      message: error.message,
    },
    requestId: reqId,
    timestamp: new Date().toISOString(),
  });
}
