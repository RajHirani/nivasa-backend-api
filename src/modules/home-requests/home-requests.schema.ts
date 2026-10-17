import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);

// Without `page`: the mobile contract's list (one status, oldest first, keyset cursor).
// With `page` (0-based): the committee portal's table (any status incl. ALL, newest first, filters, `total`).
export const listHomeRequestsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(0).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional(),
  buildingId: id('buildingId').optional(),
  role: z.enum(['OWNER', 'TENANT']).optional(),
});

export const requestParamsSchema = z.object({ requestId: id('requestId') });

export const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Enter a reason').max(500, 'Keep the reason under 500 characters'),
});
export type RejectInput = z.infer<typeof rejectSchema>;
