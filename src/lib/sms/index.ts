import { env } from '../../config/env.js';
import { ConsoleSms } from './console.js';
import type { SmsProvider } from './types.js';

// Add a provider: implement SmsProvider in its own file and add one case here (plus its env settings).
const create = (): SmsProvider => {
  switch (env.sms.driver) {
    case 'console':
      return new ConsoleSms();
    default:
      throw new Error(`Unsupported SMS_DRIVER: ${env.sms.driver}`);
  }
};

export const sms: SmsProvider = create();
// Message texts live here, not in the providers, so every provider sends the same wording.
export const sendOtpSms = (phone: string, code: string, requestId: number): Promise<void> =>
  sms.send({
    to: phone,
    text: `Your Nivaas code: ${code}. Do not share it with anyone.`,
    messageId: requestId,
  });
