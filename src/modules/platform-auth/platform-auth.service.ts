import { timingSafeEqual } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { DEVICE_PLATFORM, generateOtp, hashOtp, OTP_PURPOSE } from '../../utils/otp.js';
import { sendPlatformOtpEmail } from '../../lib/email/index.js';
import { loadPlatformAccess } from '../../lib/platform-access.js';
import { newRefreshToken, signAccessToken } from '../../lib/tokens.js';
import { getUser } from '../me/me.service.js';
import { assertOtpQuota } from '../auth/auth.service.js';
import type { OtpSent, SessionContext } from '../auth/auth.types.js';
import type { PlatformMeDto, PlatformSession } from './platform-auth.types.js';

// Only Nivas staff can sign in to the console: an active account with a current platform role.
const findStaff = (email: string) =>
  prisma.user_platform_role.findFirst({
    where: {
      is_active: true,
      end_date: null,
      role: { is_active: true },
      app_user_user_platform_role_user_idToapp_user: { email: { equals: email, mode: 'insensitive' }, is_active: true },
    },
    select: { user_id: true },
  });

// Wrong codes in the last PLATFORM_OTP_LOCK_MINUTES (across all codes sent to this email) lock sign in.
// Derived from otp_request: attempts count every try, including the one that succeeded.
const assertNotLocked = async (email: string): Promise<void> => {
  const { maxFailed, lockMinutes } = env.platformOtp;
  const lockMs = lockMinutes * 60_000;
  const rows = await prisma.otp_request.findMany({
    where: { email, otp_purpose_id: OTP_PURPOSE.PLATFORM_LOGIN, created_at: { gt: new Date(Date.now() - lockMs) } },
    orderBy: { created_at: 'asc' },
    select: { attempts: true, verified_at: true, created_at: true },
  });
  const failed = rows.map((r) => ({ at: r.created_at.getTime(), n: Math.max(0, r.attempts - (r.verified_at ? 1 : 0)) }));
  let total = failed.reduce((sum, f) => sum + f.n, 0);
  if (total < maxFailed) return;

  // The lock ends when enough old failures fall out of the window.
  let unlockAt = Date.now() + lockMs;
  for (const f of failed) {
    total -= f.n;
    if (total < maxFailed) {
      unlockAt = f.at + lockMs;
      break;
    }
  }
  const wait = Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
  throw new ApiError(429, 'OTP_LOCKED', 'Too many wrong codes, sign in is locked for a while', undefined, wait);
};

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Tells the person when the email is not Nivas staff (decided: a clear message beats hiding who works at Nivas;
// the route has its own strict per-IP limit to slow down guessing). A deactivated person and a plain app user get the same answer.
export const requestOtp = async (email: string): Promise<OtpSent> => {
  const { ttlSeconds, resendAfterSeconds } = env.otp;
  const sent: OtpSent = { resendAfterSeconds, expiresInSeconds: ttlSeconds };

  await assertNotLocked(email);
  if (!(await findStaff(email))) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'This email is not registered as Nivas staff.');
  await assertOtpQuota({ email });

  const code = generateOtp();
  const request = await prisma.otp_request.create({
    select: { id: true },
    data: {
      email,
      otp_purpose_id: OTP_PURPOSE.PLATFORM_LOGIN,
      code_hash: hashOtp(email, code),
      expires_at: new Date(Date.now() + ttlSeconds * 1000),
    },
  });
  // Delivery runs in the background; a failed send is only logged (the user can request a resend).
  sendPlatformOtpEmail(email, code).catch((err) => console.error(`[otp] email delivery failed for request ${request.id}`, err));
  return sent;
};

export const getPlatformMe = async (userId: bigint): Promise<PlatformMeDto> => {
  const [user, access] = await Promise.all([getUser(userId), loadPlatformAccess(userId)]);
  if (!access) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to the platform console');
  return { user, ...access };
};

// The refresh token is returned apart from the session: the controller puts it in a cookie, never in the body.
export const verifyOtp = async (email: string, otp: string, ctx: SessionContext): Promise<{ session: PlatformSession; refreshToken: string }> => {
  await assertNotLocked(email);
  const { maxAttempts } = env.otp;

  const request = await prisma.otp_request.findFirst({
    where: { email, otp_purpose_id: OTP_PURPOSE.PLATFORM_LOGIN, verified_at: null },
    orderBy: { created_at: 'desc' },
  });
  if (!request) throw new ApiError(400, 'OTP_INVALID', 'Incorrect OTP');
  if (request.expires_at <= new Date()) throw new ApiError(400, 'OTP_EXPIRED', 'This OTP has expired');

  // Count the attempt first (atomically) so parallel guesses cannot exceed the limit.
  const counted = await prisma.otp_request.updateMany({
    where: { id: request.id, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) throw new ApiError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many wrong attempts, request a new OTP');
  if (!safeEqual(request.code_hash, hashOtp(email, otp))) throw new ApiError(400, 'OTP_INVALID', 'Incorrect OTP');

  const staff = await findStaff(email);
  if (!staff) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to the platform console');

  const refresh = newRefreshToken();
  const session = await prisma.$transaction(async (tx) => {
    // verified_at IS NULL guard makes an OTP single-use even under concurrent requests.
    const claimed = await tx.otp_request.updateMany({
      where: { id: request.id, verified_at: null },
      data: { verified_at: new Date() },
    });
    if (claimed.count === 0) throw new ApiError(400, 'OTP_INVALID', 'Incorrect OTP');

    const created = await tx.auth_session.create({
      data: { user_id: staff.user_id, device_platform_id: DEVICE_PLATFORM.WEB, ip_address: ctx.ipAddress ?? null },
    });
    await tx.refresh_token.create({
      data: { auth_session_id: created.id, token_hash: refresh.hash, expires_at: refresh.expiresAt },
    });
    return created;
  });

  return {
    refreshToken: refresh.token,
    session: {
      accessToken: signAccessToken(staff.user_id, session.id),
      expiresIn: env.jwt.accessTtlSeconds,
      ...(await getPlatformMe(staff.user_id)),
    },
  };
};
