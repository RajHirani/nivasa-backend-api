import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);
const photoIds = (max: number) => z.array(id('photoId')).max(max, `Add at most ${max} photos`).default([]);

export const ticketParamsSchema = z.object({ ticketId: id('ticketId') });
export const commentParamsSchema = z.object({ ticketId: id('ticketId'), commentId: id('commentId') });

export const listTicketsSchema = z.object({
  page: z.coerce.number().int().min(0).max(100000).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional(), // matches the title only
  // one or several ticket_status ids (`statuses[].id` of GET /options), comma separated: ?status=1,4 
  status: z
    .string()
    .transform((v) => [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))])
    .pipe(z.array(id('status')).min(1).max(20))
    .optional(),
  categoryId: id('categoryId').optional(),
  scope: z.enum(['raised_by_me', 'assigned_to_me']).optional(),
  unassigned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type ListTicketsInput = z.infer<typeof listTicketsSchema>;

export const createTicketSchema = z
  .object({
    homeId: id('homeId').nullish(), // the caller's approved home (user_resident_map id) the complaint is about
    requestType: z.enum(['UNIT', 'SOCIETY']),
    categoryId: id('categoryId'),
    title: z.string().trim().min(1, 'Enter a title').max(80, 'Keep the title under 80 characters'),
    locationId: id('locationId').nullish(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    description: z.string().trim().min(10, 'Describe the issue in at least 10 characters').max(2000, 'Keep the description under 2000 characters'),
    photoIds: photoIds(3),
  })
  .refine((v) => v.requestType === 'SOCIETY' || !!v.homeId, { message: 'Choose the home this complaint is about', path: ['homeId'] });
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const assignSchema = z.object({ assigneeId: id('assigneeId') });

// note: the question of INFO_NEEDED, the Resolution Note of RESOLVED, the reason of CANCELLED; optional otherwise.
export const updateStatusSchema = z.object({
  status: id('status'), // a ticket_status id (`statuses[].id` of GET /options or `allowedActions.statusUpdates[].id`), checked against the DB rows in the service
  note: z.string().trim().max(1000, 'Keep the note under 1000 characters').optional(),
  photoIds: photoIds(3), // only with RESOLVED
});
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

export const cancelSchema = z.object({ reason: z.string().trim().min(1, 'Enter a reason').max(1000, 'Keep the reason under 1000 characters') });

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment').max(2000, 'Keep the comment under 2000 characters'),
  photoIds: photoIds(5),
});
export type CommentInput = z.infer<typeof commentSchema>;

export const editCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000, 'Keep the comment under 2000 characters') });
