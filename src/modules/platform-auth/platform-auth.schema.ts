import { z } from 'zod';

// Case does not matter for an email; it is lower-cased before it is looked up or hashed.
const emailSchema = z.string().trim().max(254).email('Enter a valid email address').transform((v) => v.toLowerCase());

export const requestPlatformOtpSchema = z.object({ email: emailSchema });

export const verifyPlatformOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().regex(/^[0-9]{6}$/, 'Enter the 6 digit OTP'),
});
