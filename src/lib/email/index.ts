import { env } from '../../config/env.js';
import { ConsoleEmail } from './console.js';
import { GmailEmail } from './gmail.js';
import type { EmailProvider } from './types.js';

// Add a provider: implement EmailProvider in its own file and add one case here (plus its env settings).
const create = (): EmailProvider => {
  switch (env.email.driver) {
    case 'console':
      return new ConsoleEmail();
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

export const sendPlatformOtpEmail = (to: string, code: string): Promise<void> =>
  email().send({
    to,
    subject: 'Your Nivaas platform console sign in code',
    text: `${code} is your Nivaas platform console sign in code. It expires in ${Math.round(env.otp.ttlSeconds / 60)} minutes. Do not share it with anyone.`,
  });

export const sendStaffInviteEmail = (to: string, name: string, roleName: string): Promise<void> =>
  email().send({
    to,
    subject: 'You have been invited to the Nivaas Platform Console',
    text: `Hi ${name},\n\nYou have been added to the Nivaas Platform Console as ${roleName}.\n\nSign in at ${env.platform.consoleUrl} with this email address. We will email you a one-time code each time you sign in.\n`,
  });

export const sendOtpEmail = (to: string, code: string): Promise<void> =>
  email().send({
    to,
    subject: 'Your Nivaas verification code',
    text: `${code} is your Nivaas verification code. It expires in ${Math.round(env.otp.ttlSeconds / 60)} minutes. Do not share it with anyone.`,
  });
