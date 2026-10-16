import { env, type EmailKind } from '../../config/env.js';
import { ConsoleEmail } from './console.js';
import { GmailEmail } from './gmail.js';
import { renderEmail, type EmailData } from './templates.js';
import type { EmailProvider } from './types.js';

// EVERY email of the API goes out through sendEmail below, and nowhere else: one place to switch emails off, to log them and to
// change the provider. One switch, EMAIL_SEND_ENABLED, turns every email on or off (off by default outside production, see config/env.ts).

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

// Created on first use, so a missing email setup does not stop the API while its emails are switched off.
let provider: EmailProvider | undefined;

/**
 * Sends one email of the given kind. Resolves `{ sent: false }` (and logs why) when email sending is switched off (EMAIL_SEND_ENABLED), `{ sent: true }` after the
 * provider took the message, and rejects when the provider failed. Callers decide whether to wait for it or only log a failure.
 */
export const sendEmail = async <K extends EmailKind>(kind: K, to: string, data: EmailData[K]): Promise<{ sent: boolean }> => {
  if (!env.email.sendEnabled) {
    console.info(`[email] ${kind} to ${to} was not sent: email sending is switched off (set EMAIL_SEND_ENABLED=true to send)`);
    return { sent: false };
  }
  await (provider ??= create()).send({ to, ...renderEmail(kind, data) });
  return { sent: true };
};

export type { EmailKind } from '../../config/env.js';
export type { EmailProvider } from './types.js';
