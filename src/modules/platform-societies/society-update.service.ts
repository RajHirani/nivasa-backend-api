import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { raceError } from '../platform-society-wizard/society-create.service.js';
import { getSocietyDetail } from './platform-societies.service.js';
import type { UpdateSocietyInput } from './platform-societies.schema.js';
import type { SocietyDetailDto } from './platform-societies.types.js';

const fieldError = (status: number, code: ConstructorParameters<typeof ApiError>[1], field: string, message: string) =>
  new ApiError(status, code, message, [{ field, message }]);

interface Change {
  label: string;
  from: string;
  to: string;
}

const show = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '(none)' : String(v));
const lines = (changes: Change[]) => changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('\n');

// Edit basic information and location (the Edit dialogs of the society page). Only what really changes is written, and each of the two
// groups that changed gets one Activity entry (BASIC_UPDATED / LOCATION_UPDATED) whose note lists old → new. Sending the values a
// society already has changes nothing and writes no entry. The unique indexes (name per city, registration number) answer races.
export const updateSociety = async (societyId: bigint, actorId: bigint, input: UpdateSocietyInput): Promise<SocietyDetailDto> => {
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.society.findUnique({
        where: { id: societyId },
        include: { city: { select: { id: true, name: true, state: { select: { name: true } } } } },
      });
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Society not found');

      const basic: Change[] = [];
      const location: Change[] = [];
      const data: Record<string, unknown> = {};
      const set = (group: Change[], field: string, label: string, from: string | number | null, to: string | number | null, value: unknown = to) => {
        if (from === to) return;
        group.push({ label, from: show(from), to: show(to) });
        data[field] = value;
      };

      // Location first: the name has to be unique in the city the society will be in.
      let cityName = current.city.name;
      let cityRow = null as { id: bigint; name: string; state: { name: string }; country_id: bigint } | null;
      if (input.cityId !== undefined && BigInt(input.cityId) !== current.city_id) {
        cityRow = await tx.city.findFirst({
          where: { id: BigInt(input.cityId), is_active: true, state: { is_active: true }, country: { is_active: true } },
          select: { id: true, name: true, country_id: true, state: { select: { name: true } } },
        });
        if (!cityRow) throw fieldError(400, 'VALIDATION_FAILED', 'cityId', 'Choose a city');
        location.push({ label: 'City', from: `${current.city.name}, ${current.city.state.name}`, to: `${cityRow.name}, ${cityRow.state.name}` });
        data.city_id = cityRow.id;
        data.country_id = cityRow.country_id; // the country always follows the city
        cityName = cityRow.name;
      }
      const lat = current.latitude === null ? null : Number(current.latitude);
      const lng = current.longitude === null ? null : Number(current.longitude);
      if (input.address !== undefined) set(location, 'address', 'Address', current.address, input.address);
      if (input.pincode !== undefined) set(location, 'pincode', 'Pincode', current.pincode, input.pincode);
      if (input.latitude !== undefined) set(location, 'latitude', 'Latitude', lat, input.latitude);
      if (input.longitude !== undefined) set(location, 'longitude', 'Longitude', lng, input.longitude);

      if (input.name !== undefined) set(basic, 'name', 'Name', current.name, input.name);
      if (input.registrationNumber !== undefined) set(basic, 'registration_number', 'Registration number', current.registration_number, input.registrationNumber);
      if (input.phone !== undefined) set(basic, 'phone', 'Phone', current.phone, input.phone);
      if (input.email !== undefined) set(basic, 'email', 'Email', current.email, input.email);

      // Uniqueness, with a clear message (the database indexes still decide a race).
      const name = (data.name as string | undefined) ?? current.name;
      if (data.name !== undefined || data.city_id !== undefined) {
        const clash = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM society WHERE city_id = ${(data.city_id as bigint | undefined) ?? current.city_id} AND lower(name) = lower(${name}) AND id <> ${societyId} LIMIT 1`;
        if (clash.length > 0) throw fieldError(409, 'SOCIETY_NAME_TAKEN', 'name', `A society called "${name}" already exists in ${cityName}`);
      }
      if (data.registration_number !== undefined) {
        const clash = await tx.$queryRaw<{ id: bigint }[]>`
          SELECT id FROM society WHERE lower(registration_number) = lower(${data.registration_number as string}) AND id <> ${societyId} LIMIT 1`;
        if (clash.length > 0) throw fieldError(409, 'REGISTRATION_NUMBER_TAKEN', 'registrationNumber', 'Another society already uses this registration number');
      }

      // Logo: a new one must be this person's own unattached SOCIETY_LOGO; the old file is released, so the hourly clean-up deletes it.
      if (input.logoUploadId !== undefined) {
        const next = input.logoUploadId === null ? null : BigInt(input.logoUploadId);
        if (next !== current.logo_upload_id) {
          if (next !== null) {
            const attached = await tx.upload.updateMany({
              where: { id: next, user_id: actorId, attached_at: null, upload_purpose: { code: 'SOCIETY_LOGO' } },
              data: { attached_at: new Date() },
            });
            if (attached.count !== 1) throw fieldError(400, 'VALIDATION_FAILED', 'logoUploadId', 'Upload the logo again');
          }
          if (current.logo_upload_id !== null) await tx.upload.update({ where: { id: current.logo_upload_id }, data: { attached_at: null } });
          basic.push({ label: 'Logo', from: current.logo_upload_id === null ? '(none)' : 'set', to: next === null ? '(none)' : 'changed' });
          data.logo_upload_id = next;
        }
      }

      if (basic.length === 0 && location.length === 0) return;
      await tx.society.update({ where: { id: societyId }, data: { ...data, updated_at: new Date() } });

      const types = await tx.society_activity_type.findMany({ where: { code: { in: ['BASIC_UPDATED', 'LOCATION_UPDATED'] } }, select: { id: true, code: true } });
      const typeId = (code: string) => types.find((t) => t.code === code)!.id;
      const entries = [
        ...(basic.length > 0 ? [{ activity_type_id: typeId('BASIC_UPDATED'), summary: 'Basic information updated', note: lines(basic) }] : []),
        ...(location.length > 0 ? [{ activity_type_id: typeId('LOCATION_UPDATED'), summary: 'Location updated', note: lines(location) }] : []),
      ];
      await tx.society_activity.createMany({ data: entries.map((e) => ({ ...e, society_id: societyId, actor_id: actorId })) });
    });
  } catch (e) {
    throw raceError(e) ?? e;
  }
  return getSocietyDetail(societyId);
};
