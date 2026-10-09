import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { ApiError } from '../utils/api-error.js';

// Requires a valid access token whose session is still live. Sets req.auth.
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) throw new ApiError(401, 'TOKEN_EXPIRED', 'Session expired');
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
  }

  const userId = BigInt(payload.sub);
  const sessionId = BigInt(payload.sid);
  const session = await prisma.auth_session.findUnique({
    where: { id: sessionId },
    select: { user_id: true, revoked_at: true, app_user: { select: { is_active: true } } },
  });
  if (!session || session.user_id !== userId || session.revoked_at) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
  }
  if (!session.app_user.is_active) throw new ApiError(403, 'FORBIDDEN', 'This account is disabled');

  req.auth = { userId, sessionId };
  next();
};
