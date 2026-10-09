import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { ApiError } from '../utils/api-error.js';

const body = (code: string, message: string, details?: unknown) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json(body('NOT_FOUND', 'Route not found'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    res.status(400).json(body('VALIDATION_FAILED', 'Invalid input', details));
    return;
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json(body('FILE_TOO_LARGE', 'File is too large'));
      return;
    }
    res.status(400).json(body('VALIDATION_FAILED', 'Invalid input', [{ field: err.field ?? 'file', message: 'Send one file in the "file" field' }]));
    return;
  }
  if (err instanceof ApiError) {
    if (err.retryAfterSeconds) res.setHeader('Retry-After', err.retryAfterSeconds);
    res.status(err.status).json(body(err.code, err.message, err.details));
    return;
  }
  console.error(err);
  res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong'));
};
