import { z } from 'zod';
import { countryCodeSchema, mobileSchema } from '../auth/auth.schema.js';
import { isValidNationalNumber } from '../../utils/phone.js';

export const staffRoleSchema = z.enum(['PLATFORM_ADMIN', 'PLATFORM_ONBOARDING', 'PLATFORM_SUPPORT']);

export const listStaffSchema = z.object({
  q: z.string().trim().optional(),
  role: staffRoleSchema.optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']).optional(),
  sort: z.enum(['name', 'role', 'status', 'lastActiveAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export const inviteStaffSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the full name').max(100),
    email: z.string().trim().max(254).email('Enter a valid email address').transform((v) => v.toLowerCase()),
    countryCode: countryCodeSchema,
    mobile: mobileSchema,
    role: staffRoleSchema,
  })
  .refine((v) => !mobileSchema.safeParse(v.mobile).success || isValidNationalNumber(v.countryCode, v.mobile), {
    message: 'Enter a valid mobile number',
    path: ['mobile'],
  });

export const changeRoleSchema = z.object({ role: staffRoleSchema });

export const reactivateSchema = z.object({ role: staffRoleSchema.optional() });
