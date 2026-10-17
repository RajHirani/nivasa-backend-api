import { Prisma } from '@prisma/client';
import { ensureCurrentTerm } from '../../lib/committee-term.js';
import { prisma } from '../../lib/prisma.js';
import { CACHE_KEYS, cached } from '../../lib/static-cache.js';
import { ApiError } from '../../utils/api-error.js';
import { toE164 } from '../../utils/phone.js';
import { getSocietyDetail } from '../platform-societies/platform-societies.service.js';
import type { SocietyDetailDto } from '../platform-societies/platform-societies.types.js';
import { insertBuildings } from '../platform-societies/structure-insert.js';
import type { SocietyCreateInput } from './society-wizard.schema.js';

// The final call of the Add society wizard. The wizard steps already checked what needs the database (name per city, registration number,
// email, logo, city, country code) and handed back ids, so none of that is asked again here: the request is typed by
// `societyCreateSchema`, and the database's unique indexes answer anything that changed since (see `raceError`).
// ONE transaction saves the society, the logo, the structure, the module switches, the first admin if one was given (President role +
// membership) and a CREATED activity entry. No email is sent here: invitations go out when staff press "Send invite" (Admins tab).

const fieldError = (field: string, message: string) => new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field, message }]);

// Reference rows that never change at run time, read once (cleared with the other static data).
export const societySetup = () =>
  cached(CACHE_KEYS.SOCIETY_SETUP, async () => {
    const [societyTypes, structureTypes, president, memberActive, created, modules] = await Promise.all([
      prisma.society_type.findMany({ select: { id: true, code: true } }),
      prisma.structure_type.findMany({ select: { id: true, code: true } }),
      prisma.role.findFirstOrThrow({ where: { code: 'PRESIDENT', society_id: null, role_scope: { code: 'SOCIETY' } }, select: { id: true } }),
      prisma.member_status.findUniqueOrThrow({ where: { code: 'ACTIVE' }, select: { id: true } }),
      prisma.society_activity_type.findUniqueOrThrow({ where: { code: 'CREATED' }, select: { id: true } }),
      prisma.module.findMany({ where: { is_active: true }, select: { id: true, code: true } }),
    ]);
    const byCode = (rows: { id: number; code: string }[]) => new Map(rows.map((r) => [r.code, r.id]));
    return { societyTypes: byCode(societyTypes), structureTypes: byCode(structureTypes), presidentRoleId: president.id, activeMemberStatusId: memberActive.id, createdActivityId: created.id, modules };
  });

// A unique index lost a race with another request (or a step answer is stale); say which rule it was.
export const raceError = (e: unknown): ApiError | null => {
  // A city that does not belong to that country (the composite foreign key), i.e. a body not built from step 2's answer.
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') return fieldError('cityId', 'Choose a city');
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  const target = String(e.meta?.target);
  if (target.includes('identifier')) return new ApiError(409, 'DUPLICATE_UNIT_NUMBER', 'The same name, floor or flat number is used twice in one place');
  if (target.includes('registration')) return new ApiError(409, 'REGISTRATION_NUMBER_TAKEN', 'Another society already uses this registration number');
  if (target.includes('email')) return new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'This email already belongs to another account');
  if (target.includes('phone')) return new ApiError(409, 'MOBILE_ALREADY_EXISTS', 'This mobile number already has an account');
  if (target.includes('society') || target.includes('name')) return new ApiError(409, 'SOCIETY_NAME_TAKEN', 'A society with this name already exists in this city');
  return null;
};

export const createSociety = async (actorId: bigint, input: SocietyCreateInput): Promise<SocietyDetailDto> => {
  const ref = await societySetup();
  const apartment = input.type === 'APARTMENT';
  const structureType = (code: string) => ref.structureTypes.get(code)!;
  const [buildingType, floorType, unitType] = [structureType(apartment ? 'WING' : 'SECTION'), structureType('FLOOR'), structureType(apartment ? 'FLAT' : 'HOUSE')];

  const catalogue = ref.modules.map((m) => m.code);
  const unknownModule = input.modules?.find((c) => !catalogue.includes(c));
  if (unknownModule) throw fieldError('modules', `Unknown module ${unknownModule}`);
  const switchedOn = input.modules ?? catalogue;

  const sid = { city: BigInt(input.cityId), country: BigInt(input.countryId) };
  const admin = input.admin;
  const phone = admin ? toE164(admin.countryCode, admin.mobile) : null;

  let societyId: bigint;
  try {
    societyId = await prisma.$transaction(
      async (tx) => {
        const society = await tx.society.create({
          data: {
            name: input.name,
            society_type_id: ref.societyTypes.get(input.type)!,
            country_id: sid.country,
            city_id: sid.city,
            address: input.address,
            phone: input.phone,
            email: input.email,
            pincode: input.pincode,
            latitude: input.latitude,
            longitude: input.longitude,
            registration_number: input.registrationNumber,
          },
          select: { id: true },
        });
        const societyId = society.id;

        // The logo is attached only if it is still this person's unattached SOCIETY_LOGO: the update itself is the check
        // (so it runs before the society points at the upload).
        if (input.logoUploadId) {
          const attached = await tx.upload.updateMany({
            where: { id: BigInt(input.logoUploadId), user_id: actorId, attached_at: null, upload_purpose: { code: 'SOCIETY_LOGO' } },
            data: { attached_at: new Date() },
          });
          if (attached.count !== 1) throw fieldError('logoUploadId', 'Upload the logo again');
          await tx.society.update({ where: { id: societyId }, data: { logo_upload_id: BigInt(input.logoUploadId) } });
        }

        const unitCount = await insertBuildings(tx, societyId, apartment, { building: buildingType, floor: floorType, unit: unitType }, input.buildings);

        // Every module of the catalogue gets a row, on or off.
        await tx.society_module.createMany({
          data: ref.modules.map((m) => ({ society_id: societyId, module_id: m.id, is_enabled: switchedOn.includes(m.code), updated_by: actorId })),
        });

        // First admin (optional): found by mobile number inside the transaction, because only now is it certain whether the person has an
        // account. An existing account is reused and takes the typed name and email (they apply to the account everywhere); a new one is
        // created. No email is sent: staff send the invitation themselves from the Admins tab.
        if (admin && phone) {
          const existing = await tx.app_user.findUnique({ where: { phone }, select: { id: true, full_name: true, email: true, is_active: true } });
          if (existing && !existing.is_active) throw fieldError('admin.mobile', 'This account is disabled');
          let adminId: bigint;
          if (existing) {
            adminId = existing.id;
            if (existing.full_name !== admin.name || existing.email?.toLowerCase() !== admin.email) {
              await tx.app_user.update({ where: { id: adminId }, data: { full_name: admin.name, email: admin.email } });
            }
          } else {
            adminId = (await tx.app_user.create({ data: { full_name: admin.name, phone, country_id: BigInt(admin.countryId), email: admin.email }, select: { id: true } })).id;
          }
          await tx.user_society_map.create({ data: { user_id: adminId, society_id: societyId, member_status_id: ref.activeMemberStatusId, added_by: actorId } });
          const term = await ensureCurrentTerm(tx, societyId, actorId);
          await tx.user_society_role.create({ data: { user_id: adminId, role_id: ref.presidentRoleId, society_id: societyId, term_id: term.id, granted_by: actorId } });
        }

        const noun = apartment ? 'flat' : 'house';
        await tx.society_activity.create({
          data: { society_id: societyId, activity_type_id: ref.createdActivityId, actor_id: actorId, summary: `Society created with ${unitCount} ${noun}${unitCount === 1 ? '' : 's'}` },
        });
        return societyId;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (e) {
    throw raceError(e) ?? e;
  }

  return getSocietyDetail(societyId);
};
