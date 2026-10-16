import { z } from 'zod';
import { address, cityId, coordinateNumber, email, logoUploadId, name, phone, pincode, registrationNumber, roundCoordinate } from '../platform-society-wizard/society-wizard.schema.js';

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

// Activity is read a page at a time, newest first.
export const activitySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

// The reason is optional and only staff see it (Activity tab).
export const deactivateSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Keep the reason within 500 characters')
    .optional()
    .transform((v) => v || undefined),
});

// Edit basic information and location: any subset of the fields (a missing field stays as it is). The optional ones (phone, email,
// logo, coordinates) are cleared by sending null or an empty text. The type cannot be changed, so it is refused like any unknown field.
// Same rules as steps 1 and 2 of the Add society wizard: the pieces are shared with them.
const clearable = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullable().optional());

export const updateSocietySchema = z
  .strictObject({
    name: name.optional(),
    registrationNumber: registrationNumber.optional(),
    phone: clearable(phone),
    email: clearable(email),
    logoUploadId: clearable(logoUploadId),
    address: address.optional(),
    cityId: cityId.optional(),
    pincode: pincode.optional(),
    latitude: clearable(coordinateNumber('latitude', -90, 90)).transform((v) => (v === undefined ? v : roundCoordinate(v))),
    longitude: clearable(coordinateNumber('longitude', -180, 180)).transform((v) => (v === undefined ? v : roundCoordinate(v))),
  })
  .superRefine((v, ctx) => {
    if (Object.values(v).every((x) => x === undefined)) ctx.addIssue({ code: 'custom', path: [], message: 'Send at least one field to change' });
    // Latitude and longitude come together (both a number, or both empty) and are sent together.
    if ((v.latitude === undefined) !== (v.longitude === undefined) || (v.latitude === null) !== (v.longitude === null)) {
      ctx.addIssue({ code: 'custom', path: [v.latitude === undefined || v.latitude === null ? 'latitude' : 'longitude'], message: 'Enter both latitude and longitude, or leave both empty' });
    }
  });

export type UpdateSocietyInput = z.infer<typeof updateSocietySchema>;

// Switch one module on or off.
export const setModuleSchema = z.object({ enabled: z.boolean({ error: 'Send enabled as true or false' }) });

// Delete a society for good: its exact name must be typed to confirm.
export const deleteSocietySchema = z.object({ name: z.string({ error: 'Type the society name to confirm' }) });
