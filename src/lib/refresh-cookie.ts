import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';

// A web client's refresh token lives only in a cookie: httpOnly (scripts cannot read it), SameSite=Strict (never sent
// from another site), and limited to the auth endpoints that need it. Each web client has its own cookie.
export interface RefreshCookie {
  set: (res: Response, token: string) => void;
  clear: (res: Response) => void;
  read: (req: Request) => string | null;
}

const refreshCookie = (name: string, path: string): RefreshCookie => {
  const options = (): CookieOptions => ({ httpOnly: true, secure: env.cookie.secure, sameSite: 'strict', path });
  return {
    set: (res, token) => {
      res.cookie(name, token, { ...options(), maxAge: env.jwt.refreshTtlDays * 86_400_000 });
    },
    clear: (res) => {
      res.clearCookie(name, options());
    },
    read: (req) => {
      for (const part of req.headers.cookie?.split(';') ?? []) {
        const [key, ...value] = part.trim().split('=');
        if (key === name && value.length) return decodeURIComponent(value.join('='));
      }
      return null;
    },
  };
};

export const platformRefreshCookie = refreshCookie('nivas_platform_refresh', '/api/v1/platform/auth');
export const portalRefreshCookie = refreshCookie('nivas_portal_refresh', '/api/v1/portal/auth');
