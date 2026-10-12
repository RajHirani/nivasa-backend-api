import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { ApiError } from '../utils/api-error.js';

// For endpoints driven by a cookie (so a browser sends credentials on its own): a request that names an Origin
// must come from an allowed one. Requests without an Origin (curl, servers) carry no browser cookie and pass.
export const requireAllowedOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.header('origin');
  if (origin && !env.cors.origins.includes(origin)) throw new ApiError(403, 'FORBIDDEN', 'This request is not allowed from this origin');
  next();
};
