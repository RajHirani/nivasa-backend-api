import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';

// The platform console's refresh token lives only in this cookie: httpOnly (scripts cannot read it),
// SameSite=Strict (never sent from another site), and limited to the auth endpoints that need it.
export const REFRESH_COOKIE = 'nivas_platform_refresh';
const PATH = '/api/v1/platform/auth';

const options = (): CookieOptions => ({ httpOnly: true, secure: env.cookie.secure, sameSite: 'strict', path: PATH });

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, { ...options(), maxAge: env.jwt.refreshTtlDays * 86_400_000 });
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, options());
};

export const readRefreshCookie = (req: Request): string | null => {
  for (const part of req.headers.cookie?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name === REFRESH_COOKIE && value.length) return decodeURIComponent(value.join('='));
  }
  return null;
};
