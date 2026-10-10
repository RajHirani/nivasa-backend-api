import type { RequestHandler } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { clearCache, isCacheKey } from '../../lib/static-cache.js';

// Drops every cached static value; the next request reads it from the DB again.
export const clearAll: RequestHandler = (_req, res) => {
  res.json({ cleared: clearCache() });
};

export const clearOne: RequestHandler = (req, res) => {
  const key = String(req.params.key);
  if (!isCacheKey(key)) throw new ApiError(404, 'NOT_FOUND', 'Unknown cache key');
  res.json({ cleared: clearCache(key) });
};
