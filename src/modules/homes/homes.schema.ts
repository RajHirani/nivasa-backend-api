import { z } from 'zod';

const RELATIONS_BY_ROLE = {
  OWNER: ['FLAT_OWNER', 'CO_OWNER', 'OWNER_FAMILY'],
  TENANT: ['TENANT', 'TENANT_FAMILY', 'FLATMATE'],
} as const;

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Enter a valid date');

export const homeRequestSchema = z.object({
  flatId: id('flatId'),
  role: z.enum(['OWNER', 'TENANT'], { error: 'Choose owner or tenant' }),
  relation: z.enum(['FLAT_OWNER', 'CO_OWNER', 'OWNER_FAMILY', 'TENANT', 'TENANT_FAMILY', 'FLATMATE'], {
    error: 'Choose your relation to the flat',
  }),
  occupancy: z.enum(['RESIDING', 'MOVING_IN', 'LET_OUT', 'EMPTY'], { error: 'Choose the flat status' }),
  documentIds: z.array(id('documentId')).min(1, 'Upload at least one document').max(5),
  agreementStart: date.nullish(),
  agreementEnd: date.nullish(),
}).superRefine((v, ctx) => {
  const issue = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: [field], message });
  if (!(RELATIONS_BY_ROLE[v.role] as readonly string[]).includes(v.relation)) {
    issue('relation', 'This relation does not match owner / tenant');
  }
  // Agreement dates are for tenants; an owner's are ignored.
  if (v.role === 'TENANT') {
    if (!v.agreementStart) issue('agreementStart', 'Enter the agreement start date');
    if (!v.agreementEnd) issue('agreementEnd', 'Enter the agreement end date');
    else if (v.agreementStart && v.agreementEnd <= v.agreementStart) issue('agreementEnd', 'End date must be after the start date');
  }
});
export type HomeRequestInput = z.infer<typeof homeRequestSchema>;

export const requestParamsSchema = z.object({ requestId: id('requestId') });
