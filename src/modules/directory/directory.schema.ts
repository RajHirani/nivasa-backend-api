import { z } from 'zod';
import { countryCodeSchema, mobileSchema } from '../auth/auth.schema.js';
import { isValidNationalNumber } from '../../utils/phone.js';

export const listContactsSchema = z.object({
  type: z.enum(['COMMITTEE', 'SERVICE', 'EMERGENCY', 'GUARDS'], { error: 'Choose a directory' }),
});

export const blockParamsSchema = z.object({ blockId: z.string().regex(/^[0-9]{1,18}$/, 'Invalid blockId') });

// ── committee portal ──

export const listResidentsSchema = z.object({
  page: z.coerce.number().int().min(0).max(100000).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional(),
  buildingId: z.string().regex(/^[0-9]{1,18}$/, 'Invalid buildingId').optional(),
  occupancyId: z.string().regex(/^[0-9]{1,5}$/, 'Invalid occupancyId').optional(),
});

const contactFields = {
  name: z.string().trim().min(2, 'Enter a name').max(120),
  title: z.string().trim().max(60).nullish(),
  countryCode: countryCodeSchema,
  mobile: mobileSchema,
};
const validNumber = (v: { countryCode: string; mobile: string }) => isValidNationalNumber(v.countryCode, v.mobile);
const invalidNumber = { message: 'Enter a valid mobile number', path: ['mobile'] };

export const createContactSchema = z
  .object({ type: z.enum(['EMERGENCY', 'GUARD'], { error: 'Choose a list' }), ...contactFields })
  .refine(validNumber, invalidNumber);
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object(contactFields).refine(validNumber, invalidNumber);
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const contactParamsSchema = z.object({ societyContactId: z.string().regex(/^[0-9]{1,18}$/, 'Invalid societyContactId') });
