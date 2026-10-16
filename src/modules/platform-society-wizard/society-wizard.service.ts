import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toE164 } from '../../utils/phone.js';
import type { AdminInput, AdminLookup, BasicInfo, Location, ModulesInput, StructureInput } from './society-wizard.schema.js';

const LOGO_PURPOSE = 'SOCIETY_LOGO';

const fieldError = (status: number, code: ConstructorParameters<typeof ApiError>[1], field: string, message: string) =>
  new ApiError(status, code, message, [{ field, message }]);

// The logo must be a file this staff member uploaded for this purpose and nobody has attached yet.
// (Attaching it to the society, and the 24 hour clean-up of unused uploads, happen with the final create.)
export const assertLogoUsable = async (staffId: bigint, uploadId: string): Promise<void> => {
  const upload = await prisma.upload.findFirst({
    where: { id: BigInt(uploadId), user_id: staffId, attached_at: null, upload_purpose: { code: LOGO_PURPOSE } },
    select: { id: true },
  });
  if (!upload) throw fieldError(400, 'VALIDATION_FAILED', 'logoUploadId', 'Upload the logo again');
};

// Step 1, Basic info. What can be checked without knowing the city yet:
// - the registration number must not belong to another society (the database enforces it per country; India is the only
//   active country, and a registration number is not expected to repeat across countries, so it is checked across all);
// - the logo upload must be usable.
// The society name is unique per city, so the duplicate check is done in the Location step, once the city is chosen.
export const checkBasicInfo = async (staffId: bigint, input: BasicInfo): Promise<BasicInfo> => {
  // Exact comparison ignoring case. (Prisma's `mode: 'insensitive'` is an ILIKE, where `_` and `%` act as wildcards.)
  const taken = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM society WHERE lower(registration_number) = lower(${input.registrationNumber}) LIMIT 1`;
  if (taken.length > 0) {
    throw fieldError(409, 'REGISTRATION_NUMBER_TAKEN', 'registrationNumber', 'Another society already uses this registration number');
  }
  if (input.logoUploadId) await assertLogoUsable(staffId, input.logoUploadId);
  return input;
};

// ---------------------------------------------------------------- step 2: Location

export interface LocationChecked {
  name: string;
  address: string;
  cityId: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  city: { id: string; name: string };
  state: { id: string; name: string };
  country: { id: string; code: string; name: string };
  /** Derived from the coordinates (there is no map link field); null without them. */
  mapUrl: string | null;
}

// Step 2, Location. Answers the cleaned values plus the names of the chosen city, state and country (for the review step).
// - the city must exist and be offered (its state and country active);
// - no other society of that city may have the same name (the database has a unique index on city + lower(name));
// - latitude and longitude come together or not at all (checked by the schema).
export const checkLocation = async (input: Location): Promise<LocationChecked> => {
  const city = await prisma.city.findFirst({
    where: { id: BigInt(input.cityId), is_active: true, state: { is_active: true }, country: { is_active: true } },
    select: { id: true, name: true, state: { select: { id: true, name: true } }, country: { select: { id: true, iso_code: true, name: true } } },
  });
  if (!city) throw fieldError(400, 'VALIDATION_FAILED', 'cityId', 'Choose a city');

  const sameName = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM society WHERE city_id = ${city.id} AND lower(name) = lower(${input.name}) LIMIT 1`;
  if (sameName.length > 0) {
    throw fieldError(409, 'SOCIETY_NAME_TAKEN', 'name', `A society called "${input.name}" already exists in ${city.name}`);
  }

  const mapUrl = input.latitude !== null && input.longitude !== null ? `https://www.google.com/maps?q=${input.latitude},${input.longitude}` : null;
  return {
    name: input.name,
    address: input.address,
    cityId: city.id.toString(),
    pincode: input.pincode,
    latitude: input.latitude,
    longitude: input.longitude,
    city: { id: city.id.toString(), name: city.name },
    state: { id: city.state.id.toString(), name: city.state.name },
    country: { id: city.country.id.toString(), code: city.country.iso_code, name: city.country.name },
    mapUrl,
  };
};

// ---------------------------------------------------------------- step 3: Structure

export interface StructureChecked {
  type: StructureInput['type'];
  buildings: StructureInput['buildings'];
  buildingCount: number;
  unitCount: number;
}

// Step 3, Structure. The schema has already checked the shape (type rules, at least one building, floors from 1, numbers trimmed).
// This answers the cleaned structure with its totals; nothing is saved and nothing is checked against the database yet,
// because the structure belongs to a society that does not exist until the final create.
export const checkStructure = (input: StructureInput): StructureChecked => {
  const unitCount = input.buildings.reduce(
    (sum, b) => sum + (b.houses?.length ?? 0) + (b.floors ?? []).reduce((s, f) => s + f.flats.length, 0),
    0,
  );
  return { type: input.type, buildings: input.buildings, buildingCount: input.buildings.length, unitCount };
};

// ---------------------------------------------------------------- step 4: First admin

export interface AdminChecked {
  name: string;
  countryCode: string;
  mobile: string;
  email: string;
  /** The id of the dial code's country, which the final create needs for a new account. */
  countryId: string;
  /**
   * True when this mobile number already has an account (for example a resident of another society): it is reused, and the final create
   * applies the `name` and `email` above to that account. False: a new account is created from them and invited.
   */
  existingAccount: boolean;
}

// Step 4a: the console asks for the mobile number first. An existing account comes back with its name and email, so the form
// can be filled in; the person may then change them (see checkAdmin).
export interface AdminLookupResult {
  existingAccount: boolean;
  name: string | null;
  email: string | null;
}

export const lookupAdmin = async (input: AdminLookup): Promise<AdminLookupResult> => {
  const existing = await prisma.app_user.findUnique({
    where: { phone: toE164(input.countryCode, input.mobile) },
    select: { full_name: true, email: true, is_active: true },
  });
  if (!existing) return { existingAccount: false, name: null, email: null };
  if (!existing.is_active) throw fieldError(400, 'VALIDATION_FAILED', 'mobile', 'This account is disabled');
  return { existingAccount: true, name: existing.full_name, email: existing.email };
};

// Step 4b, First admin. The person is found by mobile number:
// - an account exists (for example a resident or admin of another society): it is reused. The final create gives it the
//   President role and a membership in the new society, and applies the name and email typed here to the account itself, so
//   the change shows everywhere that person is known (the console tells the staff member this);
// - no account: a new one is created and invited.
// Either way the email must not belong to a different account; a disabled account is refused.
export const checkAdmin = async (input: AdminInput): Promise<AdminChecked> => {
  const country = await prisma.country.findFirst({ where: { dial_code: input.countryCode, is_active: true }, select: { id: true } });
  if (!country) throw fieldError(400, 'VALIDATION_FAILED', 'countryCode', 'This country is not supported yet');

  const existing = await prisma.app_user.findUnique({
    where: { phone: toE164(input.countryCode, input.mobile) },
    select: { id: true, is_active: true },
  });
  if (existing && !existing.is_active) throw fieldError(400, 'VALIDATION_FAILED', 'mobile', 'This account is disabled');

  const emailOwner = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM app_user WHERE lower(email) = lower(${input.email}) AND id <> ${existing?.id ?? 0n} LIMIT 1`;
  if (emailOwner.length > 0) throw fieldError(409, 'EMAIL_ALREADY_EXISTS', 'email', 'This email already belongs to another account');

  return { ...input, countryId: country.id.toString(), existingAccount: existing !== null };
};

// ---------------------------------------------------------------- step 5: Modules

export interface ModuleDto {
  code: string;
  name: string;
  description: string;
}

export const listModules = async (): Promise<ModuleDto[]> => {
  const rows = await prisma.module.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { code: true, name: true, description: true } });
  return rows.map((m) => ({ code: m.code, name: m.name, description: m.description ?? '' }));
};

// Step 5, Modules. Answers the chosen module codes (catalogue order, no repeats). Omitted = every module on; an empty list = all off.
export const checkModules = async (input: ModulesInput): Promise<{ modules: string[] }> => {
  const catalogue = (await listModules()).map((m) => m.code);
  const chosen = input.modules ?? catalogue;
  const unknown = chosen.find((c) => !catalogue.includes(c));
  if (unknown) throw fieldError(400, 'VALIDATION_FAILED', 'modules', `Unknown module ${unknown}`);
  return { modules: catalogue.filter((c) => chosen.includes(c)) };
};
