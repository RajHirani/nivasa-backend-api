import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toE164 } from '../../utils/phone.js';
import { env } from '../../config/env.js';
import { sendOtpEmail } from '../../lib/email/index.js';
import { sendOtpSms } from '../../lib/sms/index.js';
import { generateOtp, hashOtp, OTP_PURPOSE } from '../../utils/otp.js';
import { hashToken, newRefreshToken, signAccessToken } from '../../lib/tokens.js';
import type { AuthContext } from '../../types/auth-context.js';
import { getMe } from '../me/me.service.js';
import type { AuthSession, OtpSent, PendingSignup, SessionContext, Tokens } from './auth.types.js';

const assertSupportedCountry = async (countryCode: string): Promise<bigint> => {
  const country = await prisma.country.findFirst({
    where: { dial_code: countryCode, is_active: true },
    select: { id: true },
  });
  if (!country) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [
      { field: 'countryCode', message: 'This country is not supported yet' },
    ]);
  }
  return country.id;
};

const findUserId = async (phone: string) =>
  (await prisma.app_user.findUnique({ where: { phone }, select: { id: true } }))?.id ?? null;

export const mobileExists = async (countryCode: string, mobile: string): Promise<boolean> => {
  await assertSupportedCountry(countryCode);
  return (await findUserId(toE164(countryCode, mobile))) !== null;
};

// Resend limits come from otp_request rows: 1 per 30 s, 5 per hour per number.
const assertOtpQuota = async (phone: string): Promise<void> => {
  const { resendAfterSeconds, maxPerHour } = env.otp;
  const recent = await prisma.otp_request.findMany({
    where: { phone, created_at: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { created_at: 'desc' },
    select: { created_at: true },
  });
  const last = recent[0];
  if (last) {
    const wait = resendAfterSeconds - Math.floor((Date.now() - last.created_at.getTime()) / 1000);
    if (wait > 0) throw new ApiError(429, 'RATE_LIMITED', `Please wait ${wait}s before requesting another OTP`, undefined, wait);
  }
  if (recent.length >= maxPerHour) {
    const oldest = recent[maxPerHour - 1]!.created_at;
    const wait = Math.max(1, Math.ceil((oldest.getTime() + 3_600_000 - Date.now()) / 1000));
    throw new ApiError(429, 'RATE_LIMITED', 'Too many OTP requests, try again later', undefined, wait);
  }
};

// `email` is where the OTP is also mailed when OTP_EMAIL_ENABLE is on.
const issueOtp = async (phone: string, purposeId: number, email: string | null, pending?: PendingSignup): Promise<OtpSent> => {
  const code = generateOtp();
  const { ttlSeconds, resendAfterSeconds } = env.otp;
  const request = await prisma.otp_request.create({
    select: { id: true },
    data: {
      phone,
      otp_purpose_id: purposeId,
      code_hash: hashOtp(phone, code),
      expires_at: new Date(Date.now() + ttlSeconds * 1000),
      ...(pending && { pending_name: pending.name, pending_email: pending.email, terms_version: env.termsVersion }),
    },
  });
  // Delivery runs in the background: the OTP is already stored, the response must not wait on SMTP/SMS vendors,
  // and a failed channel is only logged (the user can request a resend).
  const sends = [sendOtpSms(phone, code, Number(request.id))];
  if (env.otp.emailEnabled && email) sends.push(sendOtpEmail(email, code));
  sends.forEach((send) => send.catch((err) => console.error(`[otp] delivery failed for request ${request.id}`, err)));
  return { resendAfterSeconds, expiresInSeconds: ttlSeconds };
};

export const requestLoginOtp = async (countryCode: string, mobile: string): Promise<OtpSent> => {
  await assertSupportedCountry(countryCode);
  const phone = toE164(countryCode, mobile);
  const user = await prisma.app_user.findUnique({ where: { phone }, select: { email: true } });
  if (!user) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'No account found for this number');
  await assertOtpQuota(phone);

  return issueOtp(phone, OTP_PURPOSE.LOGIN, user.email);
};

// No app_user row is created here; name/email/terms wait in otp_request until the OTP is verified.
export const signUp = async (
  countryCode: string,
  mobile: string,
  name: string,
  email: string,
): Promise<OtpSent> => {
  await assertSupportedCountry(countryCode);
  const phone = toE164(countryCode, mobile);
  if ((await findUserId(phone)) !== null) {
    throw new ApiError(409, 'MOBILE_ALREADY_EXISTS', 'This mobile number is already registered');
  }
  const emailTaken = await prisma.app_user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (emailTaken) throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email already registered');

  await assertOtpQuota(phone);
  return issueOtp(phone, OTP_PURPOSE.SIGNUP, email, { name, email });
};

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const alreadyExists = (e: unknown): ApiError | null => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  return String(e.meta?.target).includes('email')
    ? new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'Email already registered')
    : new ApiError(409, 'MOBILE_ALREADY_EXISTS', 'This mobile number is already registered');
};

export const verifyOtp = async (
  countryCode: string,
  mobile: string,
  otp: string,
  ctx: SessionContext,
): Promise<AuthSession> => {
  const countryId = await assertSupportedCountry(countryCode);
  const phone = toE164(countryCode, mobile);
  const { maxAttempts } = env.otp;

  const request = await prisma.otp_request.findFirst({
    where: { phone, verified_at: null },
    orderBy: { created_at: 'desc' },
  });
  if (!request) throw new ApiError(400, 'OTP_INVALID', 'Incorrect OTP');
  if (request.expires_at <= new Date()) throw new ApiError(400, 'OTP_EXPIRED', 'This OTP has expired');

  // Count the attempt first (atomically) so parallel guesses cannot exceed the limit.
  const counted = await prisma.otp_request.updateMany({
    where: { id: request.id, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) {
    throw new ApiError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many wrong attempts, request a new OTP');
  }
  if (!safeEqual(request.code_hash, hashOtp(phone, otp))) {
    throw new ApiError(400, 'OTP_INVALID', 'Incorrect OTP');
  }

  const refresh = newRefreshToken();
  try {
    const { user, session, isNewUser } = await prisma.$transaction(async (tx) => {
      // verified_at IS NULL guard makes an OTP single-use even under concurrent requests.
      const claimed = await tx.otp_request.updateMany({
        where: { id: request.id, verified_at: null },
        data: { verified_at: new Date() },
      });
      if (claimed.count === 0) throw new ApiError(400, 'OTP_INVALID', 'Incorrect OTP');

      const isNewUser = request.otp_purpose_id === OTP_PURPOSE.SIGNUP;
      const user = isNewUser
        ? await tx.app_user.create({
          data: {
            full_name: request.pending_name ?? '',
            phone,
            country_id: countryId,
            email: request.pending_email,
            terms_accepted_at: new Date(),
            terms_version: request.terms_version,
          },
        })
        : await tx.app_user.findUnique({ where: { phone } });
      if (!user) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'No account found for this number');
      if (!user.is_active) throw new ApiError(403, 'FORBIDDEN', 'This account is disabled');

      const session = await tx.auth_session.create({
        data: { user_id: user.id, ip_address: ctx.ipAddress ?? null },
      });
      await tx.refresh_token.create({
        data: { auth_session_id: session.id, token_hash: refresh.hash, expires_at: refresh.expiresAt },
      });
      return { user, session, isNewUser };
    });

    return {
      accessToken: signAccessToken(user.id, session.id),
      refreshToken: refresh.token,
      expiresIn: env.jwt.accessTtlSeconds,
      isNewUser,
      ...(await getMe(user.id, {
        id: user.id.toString(),
        countryCode,
        mobile,
        name: user.full_name,
        email: user.email,
      })),
    };
  } catch (e) {
    throw alreadyExists(e) ?? e;
  }
};

export const refreshTokens = async (refreshToken: string): Promise<Tokens> => {
  const stored = await prisma.refresh_token.findUnique({
    where: { token_hash: hashToken(refreshToken) },
    include: { auth_session: { include: { app_user: { select: { is_active: true } } } } },
  });
  const session = stored?.auth_session;
  if (!stored || !session || session.revoked_at) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again');
  }

  const revokeSession = () =>
    prisma.auth_session.update({ where: { id: session.id }, data: { revoked_at: new Date() } });
  const reused = new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Session ended, please sign in again');

  // A rotated token showing up again means it leaked: kill the whole session.
  if (stored.used_at) {
    await revokeSession();
    throw reused;
  }
  if (stored.expires_at <= new Date()) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (!session.app_user.is_active) throw new ApiError(403, 'FORBIDDEN', 'This account is disabled');

  const next = newRefreshToken();
  const rotated = await prisma.$transaction(async (tx) => {
    // used_at IS NULL guard: of two concurrent refreshes with the same token only one wins.
    const claimed = await tx.refresh_token.updateMany({
      where: { id: stored.id, used_at: null },
      data: { used_at: new Date() },
    });
    if (claimed.count === 0) return false;
    await tx.refresh_token.create({
      data: { auth_session_id: session.id, token_hash: next.hash, expires_at: next.expiresAt },
    });
    await tx.auth_session.update({ where: { id: session.id }, data: { last_used_at: new Date() } });
    return true;
  });
  if (!rotated) {
    await revokeSession();
    throw reused;
  }

  return {
    accessToken: signAccessToken(session.user_id, session.id),
    refreshToken: next.token,
    expiresIn: env.jwt.accessTtlSeconds,
  };
};

// Ends the caller's session, plus the session behind the given refresh token if it is also theirs.
export const logout = async (auth: AuthContext, refreshToken: string): Promise<void> => {
  const stored = await prisma.refresh_token.findUnique({
    where: { token_hash: hashToken(refreshToken) },
    select: { auth_session: { select: { id: true, user_id: true } } },
  });
  const ids = new Set([auth.sessionId]);
  if (stored?.auth_session.user_id === auth.userId) ids.add(stored.auth_session.id);

  await prisma.auth_session.updateMany({
    where: { id: { in: [...ids] }, revoked_at: null },
    data: { revoked_at: new Date() },
  });
};
