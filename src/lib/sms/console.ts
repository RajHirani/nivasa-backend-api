import { env } from '../../config/env.js';
import type { SmsMessage, SmsProvider } from './types.js';

// Development provider: the message is only logged. Refuses to run in production.
export class ConsoleSms implements SmsProvider {
  constructor() {
    if (env.nodeEnv === 'production') throw new Error('SMS_DRIVER=console is not allowed in production');
  }

  async send({ to, text }: SmsMessage): Promise<void> {
    console.log(`[sms:console] to ${to}: ${text}`);
  }
}
