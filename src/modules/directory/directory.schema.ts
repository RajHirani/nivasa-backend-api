import { z } from 'zod';

export const listContactsSchema = z.object({
  type: z.enum(['COMMITTEE', 'SERVICE', 'EMERGENCY', 'GUARDS'], { error: 'Choose a directory' }),
});

export const blockParamsSchema = z.object({ blockId: z.string().regex(/^[0-9]{1,18}$/, 'Invalid blockId') });
