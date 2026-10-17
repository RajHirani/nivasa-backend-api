import type { RequestHandler } from 'express';
import { ApiError } from '../../utils/api-error.js';
import * as authService from '../auth/auth.service.js';
import { platformRefreshCookie as cookie } from '../../lib/refresh-cookie.js';
import { requestPlatformOtpSchema, verifyPlatformOtpSchema } from './platform-auth.schema.js';
import * as service from './platform-auth.service.js';

export const requestOtp: RequestHandler = async (req, res) => {
  const { email } = requestPlatformOtpSchema.parse(req.body);
  res.json(await service.requestOtp(email));
};

// The refresh token goes into an httpOnly cookie; the body carries only the short lived access token.
export const verifyOtp: RequestHandler = async (req, res) => {
  const { email, otp } = verifyPlatformOtpSchema.parse(req.body);
  const { session, refreshToken } = await service.verifyOtp(email, otp, { ipAddress: req.ip });
  cookie.set(res, refreshToken);
  res.json(session);
};

export const me: RequestHandler = async (req, res) => {
  res.json(await service.getPlatformMe(req.auth!.userId));
};

// Called when the console opens (to get an access token for the session in the cookie) and whenever the access token expires.
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
