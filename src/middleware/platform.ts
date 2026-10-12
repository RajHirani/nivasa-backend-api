import type { RequestHandler } from 'express';
import { loadPlatformAccess } from '../lib/platform-access.js';
import { ApiError } from '../utils/api-error.js';

// Platform-level routes (no society): the caller needs a current, active platform role (Nivas staff)
// that grants the permission. Sets req.platform. Use after `authenticate`.
export const requirePlatformPermission = (code: string): RequestHandler => async (req, _res, next) => {
  try {
    const access = await loadPlatformAccess(req.auth!.userId);
    if (!access?.permissions.includes(code)) throw new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
    req.platform = access;
    next();
  } catch (e) {
    next(e);
  }
};
