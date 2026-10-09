import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);

export const listHomeRequestsSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});

export const requestParamsSchema = z.object({ requestId: id('requestId') });

export const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Enter a reason').max(500, 'Keep the reason under 500 characters'),
});
export type RejectInput = z.infer<typeof rejectSchema>;
