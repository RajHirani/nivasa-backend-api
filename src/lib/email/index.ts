import { env } from '../../config/env.js';
import { GmailEmail } from './gmail.js';
import type { EmailProvider } from './types.js';

// Add a provider: implement EmailProvider in its own file and add one case here (plus its env settings).
const create = (): EmailProvider => {
  switch (env.email.driver) {
    case 'gmail':
      return new GmailEmail();
    default:
      throw new Error(`Unsupported EMAIL_DRIVER: ${env.email.driver}`);
  }
};

// Created on first use, so a missing email setup does not stop the API while OTP email is switched off.
let provider: EmailProvider | undefined;
export const email = (): EmailProvider => (provider ??= create());
export type { EmailProvider } from './types.js';

export const sendOtpEmail = (to: string, code: string): Promise<void> =>
  email().send({
    to,
    subject: 'Your Nivaas verification code',
    text: `${code} is your Nivaas verification code. It expires in ${Math.round(env.otp.ttlSeconds / 60)} minutes. Do not share it with anyone.`,
  });
