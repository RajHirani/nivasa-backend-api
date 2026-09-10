import type { JwtPayload } from "jsonwebtoken";

// ─── User Types ──────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface UserRecord extends AuthUser {
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── JWT Types ───────────────────────────────────────────────

export interface TokenPayload extends JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: string;
}

// ─── Request / Response Types ────────────────────────────────

export interface RegisterBody {
  email: string;
  password: string;
  name: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export interface ApiError {
  success: false;
  message: string;
  error?: string;
  statusCode: number;
}

// ─── Express Augmentation ────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
