import { z } from 'zod';

// The "Add society" wizard has no server-side draft: the console keeps the answers and sends each step to be checked
// (this file and the others of the module), then sends everything again in one final call that checks it all once more.
// Every step returns the cleaned values (trimmed, phone in E.164, email in lower case) so the console stores exactly those.

// "", whitespace and missing all mean "not given": the field becomes null.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v), schema.nullable());

export const name = z
  .string({ error: 'Enter the society name' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Enter the society name').max(150, 'The name is too long (150 characters at most)'));

const registrationNumber = z.string().trim().max(50, 'The registration number is too long (50 characters at most)');

// Spaces, dashes and brackets are allowed on input; what is returned is E.164 (+919825011122).
const phone = z
  .string()
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Enter the phone number with its country code, for example +91 98250 11122'))
  .refine((v) => !v.startsWith('+91') || v.length === 13, 'An Indian number has 10 digits after +91');

const email = z
  .string()
  .trim()
  .max(120, 'The email is too long (120 characters at most)')
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

const logoUploadId = z.string().regex(/^[0-9]{1,18}$/, 'Upload the logo again');

export const basicInfoSchema = z.object({
  name,
  registrationNumber: optional(registrationNumber),
  type: z.enum(['APARTMENT', 'TENEMENT'], { error: 'Choose the society type' }),
  phone: optional(phone),
  email: optional(email),
  logoUploadId: optional(logoUploadId),
});

export type BasicInfo = z.infer<typeof basicInfoSchema>;

// ---------------------------------------------------------------- step 2: Location

const address = z
  .string({ error: 'Enter the address' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(5, 'Enter the full address').max(250, 'The address is too long (250 characters at most)'));

const cityId = z.string({ error: 'Choose a city' }).regex(/^[0-9]{1,18}$/, 'Choose a city');

// The pincode format depends on the country, which follows from the city, so only its shape is checked here.
const pincode = z.string({ error: 'Enter the pincode' }).trim().min(3, 'Enter the pincode').max(12, 'Enter a valid pincode');

// Typed into a text box, so "21.1702" is as good as 21.1702. Kept to 6 decimals, which is what the database stores.
const coordinate = (label: string, min: number, max: number) =>
  optional(
    z.preprocess(
      (v) => (typeof v === 'string' ? Number(v.trim()) : v),
      z
        .number({ error: `Enter a valid ${label}` })
        .min(min, `${label[0]!.toUpperCase()}${label.slice(1)} must be between ${min} and ${max}`)
        .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} must be between ${min} and ${max}`),
    ),
  ).transform((v) => (v === null ? null : Math.round(v * 1e6) / 1e6));

export const locationSchema = z
  .object({
    // From step 1: a society name is unique per city, so it can only be checked now that the city is known.
    name,
    address,
    cityId,
    pincode,
    latitude: coordinate('latitude', -90, 90),
    longitude: coordinate('longitude', -180, 180),
  })
  .superRefine((v, ctx) => {
    if ((v.latitude === null) !== (v.longitude === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [v.latitude === null ? 'latitude' : 'longitude'],
        message: 'Enter both latitude and longitude, or leave both empty',
      });
    }
  });

export type Location = z.infer<typeof locationSchema>;
