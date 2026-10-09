import type { MeDto } from '../me/me.types.js';

export interface OtpSent {
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export interface PendingSignup {
  name: string;
  email: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSession extends Tokens, MeDto {
  isNewUser: boolean;
}

export interface SessionContext {
  ipAddress?: string;
}
