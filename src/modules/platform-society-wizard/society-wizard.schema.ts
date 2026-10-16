import { z } from 'zod';
import { countryCodeSchema, mobileSchema } from '../auth/auth.schema.js';
import { isValidNationalNumber } from '../../utils/phone.js';

// The "Add society" wizard has no server-side draft: the console keeps the answers and sends each step to be checked
// (this file and the others of the module), then sends everything again in one final call that checks it all once more.
// Every step returns the cleaned values (trimmed, phone in E.164, email in lower case) so the console stores exactly those.

// "", whitespace and missing all mean "not given": the field becomes null.
export const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v), schema.nullable());

export const name = z
  .string({ error: 'Enter the society name' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Enter the society name').max(150, 'The name is too long (150 characters at most)'));

// Required. Kept in upper case, so the database's (case-sensitive) unique index treats MH-PN-77 and mh-pn-77 as the same number.
export const registrationNumber = z
  .string({ error: 'Enter the registration number' })
  .trim()
  .min(1, 'Enter the registration number')
  .max(50, 'The registration number is too long (50 characters at most)')
  .transform((v) => v.toUpperCase());

// Spaces, dashes and brackets are allowed on input; what is returned is E.164 (+919825011122).
export const phone = z
  .string()
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .pipe(z.string().regex(/^\+[1-9][0-9]{7,14}$/, 'Enter the phone number with its country code, for example +91 98250 11122'))
  .refine((v) => !v.startsWith('+91') || v.length === 13, 'An Indian number has 10 digits after +91');

export const email = z
  .string()
  .trim()
  .max(120, 'The email is too long (120 characters at most)')
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

export const logoUploadId = z.string().regex(/^[0-9]{1,18}$/, 'Upload the logo again');

export const basicInfoSchema = z.object({
  name,
  registrationNumber,
  type: z.enum(['APARTMENT', 'TENEMENT'], { error: 'Choose the society type' }),
  phone: optional(phone),
  email: optional(email),
  logoUploadId: optional(logoUploadId),
});

export type BasicInfo = z.infer<typeof basicInfoSchema>;

// ---------------------------------------------------------------- step 2: Location

export const address = z
  .string({ error: 'Enter the address' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(5, 'Enter the full address').max(250, 'The address is too long (250 characters at most)'));

export const cityId = z.string({ error: 'Choose a city' }).regex(/^[0-9]{1,18}$/, 'Choose a city');

// Any country's postal code: kept as typed (spaces tidied), only required and limited to what the database holds (12 characters).
// No format is enforced, because postal codes differ by country and the person entering it knows it.
export const pincode = z
  .string({ error: 'Enter the pincode' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Enter the pincode').max(12, 'The pincode is too long (12 characters at most)'));

// Typed into a text box, so "21.1702" is as good as 21.1702. Kept to 6 decimals, which is what the database stores.
export const coordinateNumber = (label: string, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? Number(v.trim()) : v),
    z
      .number({ error: `Enter a valid ${label}` })
      .min(min, `${label[0]!.toUpperCase()}${label.slice(1)} must be between ${min} and ${max}`)
      .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} must be between ${min} and ${max}`),
  );
export const roundCoordinate = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6);
const coordinate = (label: string, min: number, max: number) => optional(coordinateNumber(label, min, max)).transform(roundCoordinate);

const locationShape = { address, cityId, pincode, latitude: coordinate('latitude', -90, 90), longitude: coordinate('longitude', -180, 180) };

// Latitude and longitude come together or not at all.
const coordinatesTogether = (v: { latitude: number | null; longitude: number | null }, ctx: z.RefinementCtx) => {
  if ((v.latitude === null) !== (v.longitude === null)) {
    ctx.addIssue({
      code: 'custom',
      path: [v.latitude === null ? 'latitude' : 'longitude'],
      message: 'Enter both latitude and longitude, or leave both empty',
    });
  }
};

// `name` comes from step 1: a society name is unique per city, so it can only be checked now that the city is known.
export const locationSchema = z.object({ name, ...locationShape }).superRefine(coordinatesTogether);

export type Location = z.infer<typeof locationSchema>;

// ---------------------------------------------------------------- step 3: Structure

// A flat or house number is kept exactly as typed ("A-101"), only trimmed with single spaces. It becomes `structure.identifier`.
// Counts (buildings, floors, units) are not limited here; the console limits them.
const unitNumber = z
  .string({ error: 'Enter the number' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Enter the number').max(20, 'The number is too long (20 characters at most)'));

const buildingName = z
  .string({ error: 'Enter the name' })
  .transform((v) => v.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Enter the name').max(30, 'The name is too long (30 characters at most)'));

const unit = z.object({ number: unitNumber });

// The first floor is 1; there is no ground floor 0 for now.
export const floorNumber = z.number({ error: 'Enter the floor number' }).int('The floor number must be a whole number').min(1, 'The first floor is 1').max(999, 'Enter a valid floor number');

const floor = z.object({
  number: floorNumber,
  flats: z.array(unit, { error: 'Add the flats of this floor' }).min(1, 'Add at least one flat to this floor'),
});

const building = z.object({
  name: buildingName,
  floors: z.array(floor).optional(),
  houses: z.array(unit).optional(),
});

const typeEnum = z.enum(['APARTMENT', 'TENEMENT'], { error: 'Choose the society type' });
const buildingsArray = z.array(building, { error: 'Add at least one building' }).min(1, 'Add at least one building');

// An apartment society has floors with flats, a tenement society has houses; every building has something in it.
const structureRules = (v: { type: 'APARTMENT' | 'TENEMENT'; buildings: z.infer<typeof building>[] }, ctx: z.RefinementCtx) => {
  const apartment = v.type === 'APARTMENT';
  v.buildings.forEach((b, i) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path: ['buildings', i, ...path], message });
    if (apartment) {
      if (b.houses !== undefined) add(['houses'], 'An apartment society has floors and flats, not houses');
      if (!b.floors || b.floors.length === 0) add(['floors'], 'Add at least one floor to this building');
    } else {
      if (b.floors !== undefined) add(['floors'], 'A tenement society has sections and houses, not floors');
      if (!b.houses || b.houses.length === 0) add(['houses'], 'Add at least one house to this section');
    }
  });
};

export const structureSchema = z.object({ type: typeEnum, buildings: buildingsArray }).superRefine(structureRules);

export type StructureInput = z.infer<typeof structureSchema>;

// ---------------------------------------------------------------- step 4: First admin

export const adminShape = {
  name: z
    .string({ error: 'Enter the full name' })
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(2, 'Enter the full name').max(100, 'The name is too long (100 characters at most)')),
  countryCode: countryCodeSchema,
  mobile: mobileSchema,
  email,
};
const validMobile = (v: { countryCode: string; mobile: string }) => !mobileSchema.safeParse(v.mobile).success || isValidNationalNumber(v.countryCode, v.mobile);
const mobileIssue = { message: 'Enter a valid mobile number', path: ['mobile'] };

export const adminSchema = z.object(adminShape).refine(validMobile, mobileIssue);

export type AdminInput = z.infer<typeof adminSchema>;

// Edit details of an admin who is already in a society: only the name and email (the mobile number is the account's identity).
export const adminEditSchema = z
  .strictObject({ name: adminShape.name.optional(), email: adminShape.email.optional() })
  .refine((v) => v.name !== undefined || v.email !== undefined, { message: 'Send the name or the email to change' });
export type AdminEditInput = z.infer<typeof adminEditSchema>;

// Step 4 starts with the mobile number alone: the console asks whether that person already has an account.
export const adminLookupSchema = z.object({ countryCode: countryCodeSchema, mobile: mobileSchema });
export type AdminLookup = z.infer<typeof adminLookupSchema>;

// ---------------------------------------------------------------- step 5: Modules

// Codes are checked against the module catalogue in the service. Omitted = every module on.
export const modulesSchema = z.object({
  modules: z.array(z.string().trim().toUpperCase(), { error: 'Choose the modules' }).optional(),
});
export type ModulesInput = z.infer<typeof modulesSchema>;

// ---------------------------------------------------------------- step 6: the final create

const id = (message: string) => z.string({ error: message }).regex(/^[0-9]{1,18}$/, message);

// Every step's answer in one flat body. Shapes and formats are checked here (a request body is untrusted, whatever the console did);
// what the steps found in the database is NOT checked again: it comes back as ids the steps returned (`countryId` from step 2, the
// admin's `countryId` from step 4) and the database's own unique indexes answer any race.
export const societyCreateSchema = z
  .object({
    ...basicInfoSchema.shape,
    ...locationShape,
    countryId: id('Choose a city'),
    buildings: buildingsArray,
    // Optional: a society can be created with no admin and get one later from the Admins tab.
    admin: z.object({ ...adminShape, countryId: id('Choose the country code') }).refine(validMobile, mobileIssue).optional(),
    // Omitted = every module on; an empty list = all off. Unknown codes are refused when the module rows are written.
    modules: z.array(z.string().trim().toUpperCase()).optional(),
  })
  .superRefine(coordinatesTogether)
  .superRefine((v, ctx) => structureRules(v, ctx));

export type SocietyCreateInput = z.infer<typeof societyCreateSchema>;
