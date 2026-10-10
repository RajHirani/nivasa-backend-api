import { z } from 'zod';

// The purpose is checked against upload_purpose when the file is saved.
export const uploadBodySchema = z.object({
  purpose: z.string({ error: 'Choose what the file is for' }).regex(/^[A-Z_]{1,40}$/, 'Choose what the file is for'),
});

export const uploadIdSchema = z.object({ uploadId: z.string().regex(/^[0-9]{1,18}$/, 'Invalid upload id') });

// Local download links: /files/uploads/<userId>/<uuid>.<ext>?expires=&name=&sig=
export const fileKeySchema = z.string().regex(/^uploads\/[0-9]{1,18}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/);
export const fileQuerySchema = z.object({
  expires: z.coerce.number().int(),
  name: z.string().min(1).max(255),
  sig: z.string().min(1).max(200),
});
