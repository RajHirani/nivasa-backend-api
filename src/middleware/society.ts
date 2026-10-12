import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { loadAccess } from '../lib/access.js';
import { ApiError } from '../utils/api-error.js';

// Society-scoped routes: `authenticate`, then `requireMembership`, then optionally `requirePermission(...)`.
// Reads the active society from the X-Society-Id header and requires a current, ACTIVE membership in it.
export const requireMembership: RequestHandler = async (req, _res, next) => {
  const header = req.header('x-society-id');
  if (!header || !/^[0-9]{1,18}$/.test(header)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
      { field: 'X-Society-Id', message: 'Send the active society id in the X-Society-Id header' },
    ]);
  }
  const societyId = BigInt(header);
  const { userId } = req.auth!;

  const membership = await prisma.user_society_map.findFirst({
    where: { user_id: userId, society_id: societyId, left_at: null, member_status: { code: 'ACTIVE' } },
    select: { society: { select: { is_active: true } } },
  });
  if (!membership) throw new ApiError(403, 'NOT_A_MEMBER', 'You are not a member of this society');
  // Deactivated by the Nivas platform team: members get a distinct code so the app can show "contact Nivas".
  if (!membership.society.is_active) throw new ApiError(403, 'SOCIETY_INACTIVE', 'This society is currently inactive. Please contact Nivas');

  const hasHome = (await prisma.user_resident_map.count({
    where: { user_id: userId, society_id: societyId, move_out_date: null, is_active: true },
  })) > 0;
  const access = (await loadAccess(userId, [societyId], new Set(hasHome ? [societyId] : []))).get(societyId);

  req.society = { id: societyId, permissions: new Set(access?.permissions ?? []) };
  next();
};

export const requirePermission = (code: string): RequestHandler => (req, _res, next) => {
  if (!req.society?.permissions.has(code)) throw new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
  next();
};

// Passes when the caller has at least one of the permissions.
export const requireAnyPermission = (...codes: string[]): RequestHandler => (req, _res, next) => {
  if (!codes.some((c) => req.society?.permissions.has(c))) throw new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
  next();
};
