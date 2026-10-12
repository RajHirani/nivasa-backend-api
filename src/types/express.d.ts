import type { AuthContext } from './auth-context.js';
import type { PlatformAccess } from '../lib/platform-access.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      // Set by requireMembership: the active society and the caller's permission codes in it.
      // Set by requirePlatformPermission: the staff member's platform role and permissions.
      platform?: PlatformAccess;
      society?: { id: bigint; permissions: Set<string> };
    }
  }
}

export {};
