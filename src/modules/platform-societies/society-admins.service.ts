import { prisma } from '../../lib/prisma.js';
import { sendEmail } from '../../lib/email/index.js';
import { ApiError } from '../../utils/api-error.js';
import { toE164 } from '../../utils/phone.js';
import { raceError, societySetup } from '../platform-society-wizard/society-create.service.js';
import type { AdminEditInput, AdminInput } from '../platform-society-wizard/society-wizard.schema.js';
import { listAdmins } from './society-detail.service.js';
import type { SocietyAdminDto } from './platform-societies.types.js';

// The Admins tab of the society page: add an admin, edit one's name and email, remove one, send one the invitation email.
// Nothing here (or in creating a society) emails anyone by itself: the invitation is sent only by "Send invite" (inviteAdmin).
// A society may have no admin at all, and several; "first admin" is simply the one who has been admin the longest.
// An admin is a person with a current President role in the society (user_society_role), plus a membership (user_society_map).

const fieldError = (status: number, code: ConstructorParameters<typeof ApiError>[1], field: string, message: string) =>
  new ApiError(status, code, message, [{ field, message }]);

export const parseUserId = (raw: string): bigint => {
  if (!/^[0-9]{1,18}$/.test(raw)) throw new ApiError(404, 'NOT_FOUND', 'Admin not found');
  return BigInt(raw);
};

const activityTypeId = async (tx: Pick<typeof prisma, 'society_activity_type'>, code: string) =>
  (await tx.society_activity_type.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;

const adminOf = async (societyId: bigint): Promise<(userId: bigint) => Promise<SocietyAdminDto>> => {
  const admins = await listAdmins(societyId);
  return async (userId) => {
    const admin = admins.find((a) => a.userId === userId.toString());
    if (!admin) throw new ApiError(404, 'NOT_FOUND', 'Admin not found');
    return admin;
  };
};

const emailOwnerClash = async (tx: Pick<typeof prisma, '$queryRaw'>, email: string, exceptUserId: bigint | null) => {
  const clash = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM app_user WHERE lower(email) = lower(${email}) AND id <> ${exceptUserId ?? 0n} LIMIT 1`;
  if (clash.length > 0) throw fieldError(409, 'EMAIL_ALREADY_EXISTS', 'email', 'This email already belongs to another account');
};

/** The person's current President role in this society, or 404. */
const currentAdminRole = async (tx: Pick<typeof prisma, 'user_society_role' | 'society'>, societyId: bigint, userId: bigint, presidentRoleId: number) => {
  const role = await tx.user_society_role.findFirst({ where: { society_id: societyId, user_id: userId, role_id: presidentRoleId, end_date: null, is_active: true }, select: { id: true } });
  if (!role) throw new ApiError(404, 'NOT_FOUND', 'Admin not found');
  return role;
};

const societyName = async (tx: Pick<typeof prisma, 'society'>, societyId: bigint) => {
  const s = await tx.society.findUnique({ where: { id: societyId }, select: { name: true } });
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Society not found');
  return s.name;
};

// ---------------------------------------------------------------- add

// Same rule as step 4 of the wizard: found by mobile number; an existing account is reused and takes the typed name and email
// (they apply to the account everywhere), otherwise a new account is created. No email is sent; use inviteAdmin for that.
export const addAdmin = async (societyId: bigint, actorId: bigint, input: AdminInput): Promise<SocietyAdminDto> => {
  const ref = await societySetup();
  const country = await prisma.country.findFirst({ where: { dial_code: input.countryCode, is_active: true }, select: { id: true } });
  if (!country) throw fieldError(400, 'VALIDATION_FAILED', 'countryCode', 'This country is not supported yet');
  const phone = toE164(input.countryCode, input.mobile);

  let userId: bigint;
  try {
    userId = await prisma.$transaction(async (tx) => {
      await societyName(tx, societyId);
      const existing = await tx.app_user.findUnique({ where: { phone }, select: { id: true, full_name: true, email: true, is_active: true } });
      if (existing && !existing.is_active) throw fieldError(400, 'VALIDATION_FAILED', 'mobile', 'This account is disabled');
      await emailOwnerClash(tx, input.email, existing?.id ?? null);

      let adminId: bigint;
      if (existing) {
        adminId = existing.id;
        if (await tx.user_society_role.findFirst({ where: { society_id: societyId, user_id: adminId, role_id: ref.presidentRoleId, end_date: null, is_active: true }, select: { id: true } })) {
          throw fieldError(409, 'ADMIN_ALREADY_EXISTS', 'mobile', 'This person is already an admin of this society');
        }
        if (existing.full_name !== input.name || existing.email?.toLowerCase() !== input.email) {
          await tx.app_user.update({ where: { id: adminId }, data: { full_name: input.name, email: input.email, updated_at: new Date() } });
        }
      } else {
        adminId = (await tx.app_user.create({ data: { full_name: input.name, phone, country_id: country.id, email: input.email }, select: { id: true } })).id;
      }
      // A resident (or someone with another role) already has a membership here.
      if (!(await tx.user_society_map.findFirst({ where: { user_id: adminId, society_id: societyId, left_at: null }, select: { id: true } }))) {
        await tx.user_society_map.create({ data: { user_id: adminId, society_id: societyId, member_status_id: ref.activeMemberStatusId, added_by: actorId } });
      }
      await tx.user_society_role.create({ data: { user_id: adminId, role_id: ref.presidentRoleId, society_id: societyId, granted_by: actorId } });
      await tx.society_activity.create({
        data: { society_id: societyId, activity_type_id: await activityTypeId(tx, 'ADMIN_CHANGED'), actor_id: actorId, summary: `Admin added: ${input.name}`, note: `Mobile: ${phone}` },
      });
      return adminId;
    });
  } catch (e) {
    throw raceError(e) ?? e;
  }
  return (await adminOf(societyId))(userId);
};

// ---------------------------------------------------------------- send invite

// The only place an admin is emailed. The mail says they are the President of the society and how to sign in (a person who has never
// signed in is told to open the app with their mobile number). The email is sent before the answer, so staff learn if it failed;
// a successful send adds an Activity entry. Needs the admin to have an email.
export const inviteAdmin = async (societyId: bigint, actorId: bigint, userId: bigint): Promise<{ email: string; sent: boolean }> => {
  const ref = await societySetup();
  const target = await prisma.$transaction(async (tx) => {
    const sName = await societyName(tx, societyId);
    await currentAdminRole(tx, societyId, userId, ref.presidentRoleId);
    const user = await tx.app_user.findUniqueOrThrow({ where: { id: userId }, select: { full_name: true, email: true, terms_accepted_at: true } });
    if (!user.email) throw fieldError(400, 'VALIDATION_FAILED', 'email', 'This admin has no email address. Add one with Edit details first.');
    return { name: user.full_name, email: user.email, societyName: sName, neverSignedIn: !user.terms_accepted_at };
  });
  let sent: boolean;
  try {
    ({ sent } = await sendEmail('SOCIETY_ADMIN_INVITE', target.email, { name: target.name, societyName: target.societyName, neverSignedIn: target.neverSignedIn }));
  } catch (err) {
    console.error(`[society] invitation email failed for society ${societyId}`, err);
    throw new ApiError(502, 'INTERNAL_ERROR', 'The email could not be sent. Please try again.');
  }
  // `sent` is false when email sending is switched off on the server (EMAIL_SEND_ENABLED); then nothing happened to record.
  if (sent) {
    await prisma.society_activity.create({
      data: { society_id: societyId, activity_type_id: await activityTypeId(prisma, 'ADMIN_CHANGED'), actor_id: actorId, summary: `Invitation sent to ${target.name}`, note: `Email: ${target.email}` },
    });
  }
  return { email: target.email, sent };
};

// ---------------------------------------------------------------- edit details

// Name and email only. They belong to the person's account, so they change everywhere that person is known (the console says so).
// No email is sent (use "Send invite").
export const editAdmin = async (societyId: bigint, actorId: bigint, userId: bigint, input: AdminEditInput): Promise<SocietyAdminDto> => {
  const ref = await societySetup();
  try {
    await prisma.$transaction(async (tx) => {
      await societyName(tx, societyId);
      await currentAdminRole(tx, societyId, userId, ref.presidentRoleId);
      const user = await tx.app_user.findUniqueOrThrow({ where: { id: userId }, select: { full_name: true, email: true } });
      const changes: string[] = [];
      const data: { full_name?: string; email?: string } = {};
      if (input.name !== undefined && input.name !== user.full_name) {
        changes.push(`Name: ${user.full_name} → ${input.name}`);
        data.full_name = input.name;
      }
      if (input.email !== undefined && input.email !== user.email?.toLowerCase()) {
        await emailOwnerClash(tx, input.email, userId);
        changes.push(`Email: ${user.email ?? '(none)'} → ${input.email}`);
        data.email = input.email;
      }
      if (changes.length === 0) return;
      await tx.app_user.update({ where: { id: userId }, data: { ...data, updated_at: new Date() } });
      await tx.society_activity.create({
        data: { society_id: societyId, activity_type_id: await activityTypeId(tx, 'ADMIN_CHANGED'), actor_id: actorId, summary: `Admin details updated: ${data.full_name ?? user.full_name}`, note: changes.join('\n') },
      });
    });
  } catch (e) {
    throw raceError(e) ?? e;
  }
  return (await adminOf(societyId))(userId);
};

// ---------------------------------------------------------------- remove

// Ends the President role (the history stays). The membership ends too unless the person is still needed in the society:
// another current role there, or a current home.
export const removeAdmin = async (societyId: bigint, actorId: bigint, userId: bigint): Promise<void> => {
  const ref = await societySetup();
  await prisma.$transaction(async (tx) => {
    await societyName(tx, societyId);
    const role = await currentAdminRole(tx, societyId, userId, ref.presidentRoleId);
    const now = new Date();
    await tx.user_society_role.update({ where: { id: role.id }, data: { end_date: now, is_active: false, ended_by: actorId, updated_at: now } });
    const [otherRoles, homes] = await Promise.all([
      tx.user_society_role.count({ where: { society_id: societyId, user_id: userId, end_date: null, is_active: true } }),
      tx.user_resident_map.count({ where: { society_id: societyId, user_id: userId, move_out_date: null, is_active: true } }),
    ]);
    if (otherRoles === 0 && homes === 0) {
      await tx.user_society_map.updateMany({ where: { society_id: societyId, user_id: userId, left_at: null }, data: { left_at: now, updated_at: now } });
    }
    const user = await tx.app_user.findUniqueOrThrow({ where: { id: userId }, select: { full_name: true, phone: true } });
    await tx.society_activity.create({
      data: { society_id: societyId, activity_type_id: await activityTypeId(tx, 'ADMIN_CHANGED'), actor_id: actorId, summary: `Admin removed: ${user.full_name}`, note: `Mobile: ${user.phone}` },
    });
  });
};
