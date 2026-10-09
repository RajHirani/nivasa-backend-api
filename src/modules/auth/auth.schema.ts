import { z } from 'zod';
import { isValidNationalNumber } from '../../utils/phone.js';

export const countryCodeSchema = z.string().regex(/^\+[0-9]{1,4}$/, 'Enter a valid country code, e.g. +91');

export const mobileSchema = z.string().regex(/^[0-9]{6,14}$/, 'Enter a valid mobile number');

const phoneFields = { countryCode: countryCodeSchema, mobile: mobileSchema };

// Only checks the per-country length once the generic format passed, so one bad value yields one error.
const validNumber = (v: { countryCode: string; mobile: string }) =>
  !mobileSchema.safeParse(v.mobile).success || isValidNationalNumber(v.countryCode, v.mobile);
const invalidNumber = { message: 'Enter a valid mobile number', path: ['mobile'] };

export const checkMobileSchema = z.object(phoneFields).refine(validNumber, invalidNumber);

export const requestOtpSchema = checkMobileSchema;

export const signUpSchema = z
  .object({
    ...phoneFields,
    name: z.string().trim().min(2, 'Enter your name').max(100),
    email: z.string().trim().max(254).email('Enter a valid email address'),
    termsAccepted: z.literal(true, { error: 'Please accept the Terms & Conditions' }),
  })
  .refine(validNumber, invalidNumber);

export const verifyOtpSchema = z
  .object({ ...phoneFields, otp: z.string().regex(/^[0-9]{6}$/, 'Enter the 6 digit OTP') })
  .refine(validNumber, invalidNumber);

export const refreshSchema = z.object({ refreshToken: z.string().min(1, 'Refresh token is required') });

// deviceToken (push) is accepted but not stored until the /devices endpoint and its table exist.
export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
  deviceToken: z.string().optional(),
});
