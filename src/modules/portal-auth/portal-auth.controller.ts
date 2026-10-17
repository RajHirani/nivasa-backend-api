import type { RequestHandler } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { verifyOtpSchema } from '../auth/auth.schema.js';
import * as authService from '../auth/auth.service.js';
import { portalRefreshCookie as cookie } from '../../lib/refresh-cookie.js';

// Committee Portal (web) sign in: the same checks as the mobile /auth endpoints, but the refresh token travels in an
// httpOnly cookie and never in a body. Asking for the code is the shared POST /auth/otp/request.

export const verifyOtp: RequestHandler = async (req, res) => {
  const { countryCode, mobile, otp } = verifyOtpSchema.parse(req.body);
  const { refreshToken, ...session } = await authService.verifyOtp(countryCode, mobile, otp, { ipAddress: req.ip });
  cookie.set(res, refreshToken);
  res.json(session);
};

// Called when the portal opens (to get an access token for the session in the cookie) and whenever the access token expires.
export const refresh: RequestHandler = async (req, res) => {
  const token = cookie.read(req);
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in');
  try {
    const rotated = await authService.refreshWithGrace(token);
    if (rotated.refreshToken) cookie.set(res, rotated.refreshToken);
    res.json({ accessToken: rotated.accessToken, expiresIn: rotated.expiresIn });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) cookie.clear(res);
    throw e;
  }
};

// Needs only the cookie, so a session whose access token has expired can still be ended.
export const logout: RequestHandler = async (req, res) => {
  const token = cookie.read(req);
  if (token) await authService.endSessionByRefreshToken(token);
  cookie.clear(res);
  res.status(204).end();
};
