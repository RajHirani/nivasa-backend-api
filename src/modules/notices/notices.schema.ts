import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);

export const noticeParamsSchema = z.object({ noticeId: id('noticeId') });

// Portal list: `page` switches to offset mode (committee only). Without it, the app's cursor list.
export const listNoticesSchema = z.object({
  page: z.coerce.number().int().min(0).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional(), // matches the title only
  status: id('status').optional(), // a notice_status id (`statuses[].id` of GET /options); none = every status, deleted included (committee)
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(500).optional(),
});
export type ListNoticesInput = z.infer<typeof listNoticesSchema>;

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Enter a valid date');

const fields = {
  title: z.string().trim().min(1, 'Enter a title').max(100, 'Keep the title under 100 characters'),
  body: z.string().trim().min(1, 'Write the message').max(2000, 'Keep the message under 2000 characters'),
  audienceId: id('audienceId'), // a notice_audience id (`audiences[].id` of GET /options)
  buildingIds: z.array(id('buildingId')).max(200),
  expiresOn: dateOnly.nullable(),
  isPinned: z.boolean(),
  bannerId: id('bannerId').nullable(), // a NOTICE_BANNER upload
  attachmentIds: z.array(id('attachmentId')).max(5, 'Add at most 5 files'), // NOTICE_ATTACHMENT uploads
};

export const createNoticeSchema = z.object({
  ...fields,
  buildingIds: fields.buildingIds.default([]),
  expiresOn: fields.expiresOn.default(null),
  isPinned: fields.isPinned.default(false),
  bannerId: fields.bannerId.default(null),
  attachmentIds: fields.attachmentIds.default([]),
});
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;

// Every field optional: only what is sent changes. `attachmentIds` is the full list that should remain.
export const updateNoticeSchema = z.object(fields).partial();
export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;
