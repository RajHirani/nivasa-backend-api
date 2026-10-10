import 'dotenv/config';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const list = (key: string, fallback: string): string[] =>
  (process.env[key] ?? fallback).split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    secret: required('JWT_SECRET'),
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 30),
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
};
