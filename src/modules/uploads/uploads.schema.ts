import { z } from 'zod';

export const uploadBodySchema = z.object({
  purpose: z.enum(['sales_deed', 'rent_agreement', 'ticket_photo', 'ticket_reply_photo', 'ticket_resolution_photo'], {
    error: 'Choose what the file is for',
  }),
});

export const uploadIdSchema = z.object({ uploadId: z.string().regex(/^[0-9]{1,18}$/, 'Invalid upload id') });

// Local download links: /files/uploads/<userId>/<uuid>.<ext>?expires=&name=&sig=
export const fileKeySchema = z.string().regex(/^uploads\/[0-9]{1,18}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/);
export const fileQuerySchema = z.object({
  expires: z.coerce.number().int(),
  name: z.string().min(1).max(255),
  sig: z.string().min(1).max(200),
});
