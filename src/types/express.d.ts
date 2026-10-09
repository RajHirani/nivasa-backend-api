import type { AuthContext } from './auth-context.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      // Set by requireMembership: the active society and the caller's permission codes in it.
      society?: { id: bigint; permissions: Set<string> };
    }
  }
}

export {};
