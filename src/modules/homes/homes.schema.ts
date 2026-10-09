import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Enter a valid date');

export const homeRequestSchema = z.object({
  societyId: id('societyId'),
  buildingId: id('buildingId'),
  flatId: id('flatId'),
  role: z.enum(['owner', 'tenant'], { error: 'Choose owner or tenant' }),
  relation: z.enum(['flat_owner', 'co_owner', 'owner_family', 'tenant', 'tenant_family', 'flatmate'], {
    error: 'Choose your relation to the flat',
  }),
  occupancy: z.enum(['residing', 'moving_in', 'let_out', 'empty'], { error: 'Choose the flat status' }),
  documentIds: z.array(id('documentId')).min(1, 'Upload at least one document').max(5),
  agreementStart: date.nullish(),
  agreementEnd: date.nullish(),
});
export type HomeRequestInput = z.infer<typeof homeRequestSchema>;

export const requestParamsSchema = z.object({ requestId: id('requestId') });
