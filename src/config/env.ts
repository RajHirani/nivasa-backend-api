import 'dotenv/config';

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

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
  termsVersion: process.env.TERMS_VERSION ?? '1.0',
  otp: {
    hashSecret: required('OTP_HASH_SECRET'),
    devFixedCode: process.env.OTP_DEV_FIXED_CODE || undefined,
    length: 6,
    ttlSeconds: 300,
    resendAfterSeconds: 30,
    maxAttempts: 5,
    maxPerHour: 5,
  },
};
