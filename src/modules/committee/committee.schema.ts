import { z } from 'zod';
import { countryCodeSchema, mobileSchema } from '../auth/auth.schema.js';
import { isValidNationalNumber } from '../../utils/phone.js';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);
const isoDate = (what: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `Enter a valid ${what}`).refine((v) => !Number.isNaN(Date.parse(v)), `Enter a valid ${what}`);
const roleId = id('roleId');

export const listMembersSchema = z.object({ termId: id('termId').optional() });
export const searchResidentsSchema = z.object({ q: z.string().trim().max(100).default('') });
export const assignmentParamsSchema = z.object({ assignmentId: id('assignmentId') });
export const lookupMemberSchema = z.object({ countryCode: countryCodeSchema, mobile: mobileSchema }).refine((v) => isValidNationalNumber(v.countryCode, v.mobile), { message: 'Enter a valid mobile number', path: ['mobile'] });

export const addMemberSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resident'), userId: id('userId'), roleId }),
  z
    .object({
      kind: z.literal('external'),
      name: z.string().trim().min(2, 'Enter the name').max(120),
      countryCode: countryCodeSchema,
      mobile: mobileSchema,
      roleId,
    })
    .refine((v) => isValidNationalNumber(v.countryCode, v.mobile), { message: 'Enter a valid mobile number', path: ['mobile'] }),
]);
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const changeRoleSchema = z.object({ roleId });

export const termParamsSchema = z.object({ termId: id('termId') });
export const renameTermSchema = z.object({ name: z.string().trim().min(1, 'Enter a name for the term').max(40, 'Keep the name under 40 characters') });

export const archiveTermSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name for the new term').max(40),
    startDate: isoDate('start date'),
    endDate: isoDate('end date').nullish(), // planned end; optional (the day it is archived becomes the end)
    carryOver: z.array(id('assignmentId')).max(500).default([]),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, { message: 'The end date must be after the start date', path: ['endDate'] });
export type ArchiveTermInput = z.infer<typeof archiveTermSchema>;
