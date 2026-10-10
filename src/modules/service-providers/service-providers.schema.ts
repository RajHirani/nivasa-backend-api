import { z } from 'zod';
import { countryCodeSchema, mobileSchema } from '../auth/auth.schema.js';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);
const name = z.string().trim().min(2, 'Enter a name').max(120);

export const providerParamsSchema = z.object({ providerId: id('providerId') });
export const householdParamsSchema = z.object({ providerId: id('providerId'), unitId: id('unitId') });

export const createProviderSchema = z.object({
  serviceTypeId: id('serviceTypeId'),
  name,
  countryCode: countryCodeSchema,
  mobile: mobileSchema,
  // Daily-help types only: link the provider to this home of the caller right away.
  unitId: id('unitId').optional(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z
  .object({
    serviceTypeId: id('serviceTypeId').optional(),
    name: name.optional(),
    countryCode: countryCodeSchema.optional(),
    mobile: mobileSchema.optional(),
  })
  .refine((v) => (v.countryCode === undefined) === (v.mobile === undefined), {
    message: 'Send the country code and mobile together',
    path: ['mobile'],
  });
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const linkHomeSchema = z.object({ unitId: id('unitId') });

export const reviewSchema = z.object({
  rating: z.number().int('Choose a rating from 1 to 5').min(1, 'Choose a rating from 1 to 5').max(5, 'Choose a rating from 1 to 5'),
  comment: z.string().trim().max(1000, 'Keep the comment under 1000 characters').nullish(),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const listReviewsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});
