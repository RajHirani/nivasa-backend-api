import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import type { BasicInfo, Location } from './society-wizard.schema.js';

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
  if (input.registrationNumber) {
    // Exact comparison ignoring case. (Prisma's `mode: 'insensitive'` is an ILIKE, where `_` and `%` act as wildcards.)
    const taken = await prisma.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM society WHERE lower(registration_number) = lower(${input.registrationNumber}) LIMIT 1`;
    if (taken.length > 0) {
      throw fieldError(409, 'REGISTRATION_NUMBER_TAKEN', 'registrationNumber', 'Another society already uses this registration number');
    }
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
  country: { code: string; name: string };
  /** Derived from the coordinates (there is no map link field); null without them. */
  mapUrl: string | null;
}

const INDIA = 'IN';
const INDIAN_PINCODE = /^[1-9][0-9]{5}$/;
const OTHER_PINCODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/;

// Step 2, Location. Answers the cleaned values plus the names of the chosen city, state and country (for the review step).
// - the city must exist and be offered (its state and country active);
// - the pincode must fit the country (India: 6 digits, not starting with 0; spaces are dropped);
// - no other society of that city may have the same name (the database has a unique index on city + lower(name));
// - latitude and longitude come together or not at all (checked by the schema).
export const checkLocation = async (input: Location): Promise<LocationChecked> => {
  const city = await prisma.city.findFirst({
    where: { id: BigInt(input.cityId), is_active: true, state: { is_active: true }, country: { is_active: true } },
    select: { id: true, name: true, state: { select: { id: true, name: true } }, country: { select: { iso_code: true, name: true } } },
  });
  if (!city) throw fieldError(400, 'VALIDATION_FAILED', 'cityId', 'Choose a city');

  const indian = city.country.iso_code === INDIA;
  const pincode = indian ? input.pincode.replace(/\s+/g, '') : input.pincode.replace(/\s+/g, ' ');
  if (!(indian ? INDIAN_PINCODE : OTHER_PINCODE).test(pincode)) {
    throw fieldError(400, 'VALIDATION_FAILED', 'pincode', indian ? 'Enter a 6 digit pincode that does not start with 0' : 'Enter a valid pincode');
  }

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
    pincode,
    latitude: input.latitude,
    longitude: input.longitude,
    city: { id: city.id.toString(), name: city.name },
    state: { id: city.state.id.toString(), name: city.state.name },
    country: { code: city.country.iso_code, name: city.country.name },
    mapUrl,
  };
};
