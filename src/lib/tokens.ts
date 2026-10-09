import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // auth_session id
}

export const signAccessToken = (userId: bigint, sessionId: bigint): string =>
  jwt.sign({ sid: sessionId.toString() }, env.jwt.secret, {
    subject: userId.toString(),
    expiresIn: env.jwt.accessTtlSeconds,
  });

// Opaque random string; only its SHA-256 is stored in refresh_token.token_hash.
export const newRefreshToken = (): { token: string; hash: string; expiresAt: Date } => {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + env.jwt.refreshTtlDays * 86_400_000),
  };
};

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  jwt.verify(token, env.jwt.secret) as unknown as AccessTokenPayload;
