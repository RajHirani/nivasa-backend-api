import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../utils/api-error.js';

// Platform-level routes (no society): the caller needs a current, active platform role that is a super admin
// or grants the permission. Use after `authenticate`.
export const requirePlatformPermission = (code: string): RequestHandler => async (req, _res, next) => {
  try {
    const held = await prisma.user_society_role.findFirst({
      where: {
        user_id: req.auth!.userId,
        society_id: null,
        is_active: true,
        end_date: null,
        role: {
          is_active: true,
          OR: [{ is_super_admin: true }, { role_permission: { some: { permission: { code, is_active: true } } } }],
        },
      },
      select: { id: true },
    });
    if (!held) throw new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
    next();
  } catch (e) {
    next(e);
  }
};
