// SMS provider is undecided. Until one is wired, OTPs are only logged (never in production).
import { env } from '../config/env.js';

export const sendOtpSms = async (phone: string, code: string): Promise<void> => {
  if (env.nodeEnv === 'production') throw new Error('SMS provider not configured');
  console.log(`[sms:dev] OTP for ${phone}: ${code}`);
};
