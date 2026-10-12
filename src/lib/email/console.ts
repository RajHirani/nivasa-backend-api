import { env } from '../../config/env.js';
import type { EmailMessage, EmailProvider } from './types.js';

// Development provider: the message is only logged. Refuses to run in production.
export class ConsoleEmail implements EmailProvider {
  constructor() {
    if (env.nodeEnv === 'production') throw new Error('EMAIL_DRIVER=console is not allowed in production');
  }

  async send({ to, subject, text }: EmailMessage): Promise<void> {
    console.log(`[email:console] to ${to}: ${subject}: ${text}`);
  }
}
