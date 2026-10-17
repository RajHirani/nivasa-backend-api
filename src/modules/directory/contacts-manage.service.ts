import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toE164 } from '../../utils/phone.js';
import type { CreateContactInput, UpdateContactInput } from './directory.schema.js';
import type { ContactDto } from './directory.types.js';

const invalid = (field: string, message: string) => new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field, message }]);

const toDto = (r: { id: bigint; name: string; title: string | null; phone: string; country: { dial_code: string } }): ContactDto => ({
  userId: null,
  societyContactId: r.id.toString(),
  name: r.name,
  phone: r.phone,
  countryCode: r.country.dial_code,
  label: r.title,
  editable: true,
});
const rowSelect = { id: true, name: true, title: true, phone: true, country: { select: { dial_code: true } } } as const;

const countryId = async (countryCode: string) => {
  const country = await prisma.country.findFirst({ where: { dial_code: countryCode, is_active: true }, select: { id: true } });
  if (!country) throw invalid('countryCode', 'This country is not supported yet');
  return country.id;
};

// The same number is not listed twice in one list. The guards list also counts guards who hold the Security role.
const assertNotListed = async (societyId: bigint, category: string, phone: string, exceptId: bigint | null) => {
  const same = await prisma.society_contact.findFirst({
    where: { society_id: societyId, is_active: true, phone, contact_category: { code: category }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  });
  const holder =
    !same && category === 'GUARD'
      ? await prisma.user_society_role.findFirst({
          where: {
            society_id: societyId,
            is_active: true,
            end_date: null,
            role: { code: { in: env.directory.guardRoleCodes }, is_active: true },
            app_user_user_society_role_user_idToapp_user: { phone },
          },
          select: { app_user_user_society_role_user_idToapp_user: { select: { full_name: true } } },
        })
      : null;
  const who = same?.name ?? holder?.app_user_user_society_role_user_idToapp_user.full_name;
  if (who) {
    const list = category === 'GUARD' ? 'guards' : 'emergency';
    throw new ApiError(409, 'DUPLICATE_CONTACT', 'This number is already listed', [{ field: 'mobile', message: `${who} already has this number in the ${list} list.` }]);
  }
};

// Emergency numbers need to say what they are for. A guard's title or role (for example "Main Gate") is optional: sent empty
// or null it is cleared, left out of an edit it stays as it was.
const titleFor = (category: string, title: string | null | undefined): string | null | undefined => {
  if (category === 'EMERGENCY') {
    if (!title?.trim()) throw invalid('title', 'Enter what this number is for');
    return title.trim();
  }
  if (title === undefined) return undefined;
  return title?.trim() || null;
};

export const createContact = async (societyId: bigint, actorId: bigint, input: CreateContactInput): Promise<ContactDto> => {
  const phone = toE164(input.countryCode, input.mobile);
  const [country, category] = await Promise.all([countryId(input.countryCode), prisma.contact_category.findFirstOrThrow({ where: { code: input.type }, select: { id: true } })]);
  const title = titleFor(input.type, input.title);
  await assertNotListed(societyId, input.type, phone, null);
  const last = await prisma.society_contact.aggregate({ where: { society_id: societyId, contact_category_id: category.id, is_active: true }, _max: { sort_order: true } });
  const row = await prisma.society_contact.create({
    data: { society_id: societyId, contact_category_id: category.id, name: input.name, title: title ?? null, phone, country_id: country, sort_order: (last._max.sort_order ?? 0) + 1, created_by: actorId },
    select: rowSelect,
  });
  return toDto(row);
};

// The society_contact row of this society (a role holder is not one: they are changed through their role).
const loadContact = async (societyId: bigint, societyContactId: string) => {
  const row = await prisma.society_contact.findFirst({
    where: { id: BigInt(societyContactId), society_id: societyId, is_active: true },
    select: { id: true, contact_category: { select: { code: true } } },
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
  return { id: row.id, category: row.contact_category.code };
};

export const updateContact = async (societyId: bigint, societyContactId: string, input: UpdateContactInput): Promise<ContactDto> => {
  const current = await loadContact(societyId, societyContactId);
  const phone = toE164(input.countryCode, input.mobile);
  const country = await countryId(input.countryCode);
  const title = titleFor(current.category, input.title);
  await assertNotListed(societyId, current.category, phone, current.id);
  const row = await prisma.society_contact.update({
    where: { id: current.id },
    data: { name: input.name, ...(title !== undefined && { title }), phone, country_id: country, updated_at: new Date() },
    select: rowSelect,
  });
  return toDto(row);
};

// Soft removal: the number disappears from the directory.
export const removeContact = async (societyId: bigint, societyContactId: string): Promise<void> => {
  const current = await loadContact(societyId, societyContactId);
  await prisma.society_contact.update({ where: { id: current.id }, data: { is_active: false, updated_at: new Date() } });
};
