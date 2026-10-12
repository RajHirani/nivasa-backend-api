import { createHmac, randomInt } from 'node:crypto';
import { env } from '../config/env.js';

export const OTP_PURPOSE = { LOGIN: 1, SIGNUP: 2, PLATFORM_LOGIN: 3 } as const;
// device_platform ids
export const DEVICE_PLATFORM = { IOS: 1, ANDROID: 2, WEB: 3 } as const;

export const generateOtp = (): string => {
  if (env.nodeEnv !== 'production' && env.otp.devFixedCode) return env.otp.devFixedCode;
  return randomInt(0, 10 ** env.otp.length).toString().padStart(env.otp.length, '0');
};

// `subject` is the phone (mobile login) or the lower-cased email (platform console login) the code was sent to.
export const hashOtp = (subject: string, code: string): string =>
  createHmac('sha256', env.otp.hashSecret).update(`${subject}:${code}`).digest('hex');
