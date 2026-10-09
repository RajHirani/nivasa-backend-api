import { createHmac, randomInt } from 'node:crypto';
import { env } from '../config/env.js';

export const OTP_PURPOSE = { LOGIN: 1, SIGNUP: 2 } as const;

export const generateOtp = (): string => {
  if (env.nodeEnv !== 'production' && env.otp.devFixedCode) return env.otp.devFixedCode;
  return randomInt(0, 10 ** env.otp.length).toString().padStart(env.otp.length, '0');
};

export const hashOtp = (phone: string, code: string): string =>
  createHmac('sha256', env.otp.hashSecret).update(`${phone}:${code}`).digest('hex');
