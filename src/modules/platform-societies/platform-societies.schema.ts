import { z } from 'zod';

export const listSocietiesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['APARTMENT', 'TENEMENT']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  sort: z.enum(['name', 'city', 'type', 'status', 'units', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export type ListSocietiesParams = z.infer<typeof listSocietiesSchema>;
