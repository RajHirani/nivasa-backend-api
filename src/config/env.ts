import 'dotenv/config';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const list = (key: string, fallback: string): string[] =>
  (process.env[key] ?? fallback).split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);

const consoleUrl = process.env.PLATFORM_CONSOLE_URL ?? 'http://localhost:5173/platform/login';
const nodeEnv = process.env.NODE_ENV ?? 'development';
const origin = (url: string) => url.trim().replace(/\/+$/, '');

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    secret: required('JWT_SECRET'),
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
    // A refresh token that was just rotated is still honoured for this long, by clients that keep it in a cookie
    // (the platform console): two tabs refreshing at the same moment both carry the same old cookie.
    refreshReuseGraceSeconds: Number(process.env.REFRESH_REUSE_GRACE_SECONDS ?? 10),
  },
  cors: {
    // Browser origins allowed to call the API with cookies: the Platform Console's own origin plus CORS_ORIGINS.
    origins: [...new Set([new URL(consoleUrl).origin, ...(process.env.CORS_ORIGINS ?? '').split(',').map(origin).filter(Boolean)])],
  },
  cookie: {
    // The platform console's refresh token cookie. Secure needs https, so it is only on in production by default.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : nodeEnv === 'production',
  },
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? `http://localhost:${Number(process.env.PORT ?? 3000)}`).replace(/\/$/, ''),
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    uploadDir: process.env.UPLOAD_DIR ?? './storage',
    downloadUrlTtlSeconds: Number(process.env.FILE_URL_TTL_SECONDS ?? 3600),
  },
  sms: {
    // 'console' logs the message (dev only). Real providers (twilio ...) are added in lib/sms/.
    driver: process.env.SMS_DRIVER ?? 'console',
  },
  email: {
    driver: process.env.EMAIL_DRIVER ?? 'gmail',
    gmail: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  },
  directory: {
    // Occupancy statuses whose residents appear in the Resident Directory (a "Moving in" status can be added here later).
    occupancyCodes: list('DIRECTORY_OCCUPANCY_CODES', 'RESIDING'),
    // Society roles listed on the Society Committee tab.
    committeeRoleCodes: list('DIRECTORY_COMMITTEE_ROLES', 'PRESIDENT,SECRETARY,TREASURER,COMMITTEE'),
    // Holders of these roles are listed as guards, next to the GUARD contacts.
    guardRoleCodes: list('DIRECTORY_GUARD_ROLES', 'SECURITY'),
  },
  termsVersion: process.env.TERMS_VERSION ?? '1.0',
  otp: {
    hashSecret: required('OTP_HASH_SECRET'),
    devFixedCode: process.env.OTP_DEV_FIXED_CODE || undefined,
    // Also email the OTP (in addition to the SMS).
    emailEnabled: process.env.OTP_EMAIL_ENABLE === 'true',
    length: 6,
    ttlSeconds: 300,
    resendAfterSeconds: 30,
    maxAttempts: 5,
    maxPerHour: 5,
  },
  platform: {
    // Where invited staff are told to sign in (the Platform Console login page).
    consoleUrl,
  },
  platformOtp: {
    // Platform console sign in locks after this many wrong codes within the window.
    maxFailed: Number(process.env.PLATFORM_OTP_MAX_FAILED ?? 3),
    lockMinutes: Number(process.env.PLATFORM_OTP_LOCK_MINUTES ?? 15),
  },
};
