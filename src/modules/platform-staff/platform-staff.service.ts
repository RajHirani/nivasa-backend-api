import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { DEVICE_PLATFORM } from '../../utils/otp.js';
import { toE164 } from '../../utils/phone.js';
import { sendEmail } from '../../lib/email/index.js';
import type { StaffMemberDto, StaffPageDto, StaffRoleCode, StaffRoleDto, StaffStatus } from './platform-staff.types.js';

// Relation names Prisma generated for the several foreign keys from user_platform_role to app_user.
const USER = 'app_user_user_platform_role_user_idToapp_user';
const GRANTER = 'app_user_user_platform_role_granted_byToapp_user';

const PLATFORM_SCOPE = 'PLATFORM';
// Serialises the changes that could remove the last Super Admin.
const SUPER_ADMIN_LOCK = 7001;
const RESEND_INVITE_AFTER_MS = 60_000;

const validationError = (field: string, message: string) =>
  new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field, message }]);

const parseId = (value: string): bigint => {
  if (!/^[0-9]{1,18}$/.test(value)) throw new ApiError(404, 'NOT_FOUND', 'Staff member not found');
  return BigInt(value);
};

// ---------------------------------------------------------------- reading

// Staff are few (tens), so the list is built in memory: it keeps the status rules (invited / active / deactivated)
// in one place and makes filtering and sorting on them trivial. Revisit if the team ever reaches thousands.
const loadStaff = async (): Promise<StaffMemberDto[]> => {
  const [rows, sessions] = await Promise.all([
    prisma.user_platform_role.findMany({
      orderBy: { id: 'asc' },
      select: {
        user_id: true,
        end_date: true,
        is_active: true,
        created_at: true,
        role: { select: { code: true, name: true } },
        [USER]: { select: { full_name: true, phone: true, email: true, is_active: true, country: { select: { dial_code: true } } } },
        [GRANTER]: { select: { full_name: true } },
      },
    }),
    prisma.auth_session.groupBy({
      by: ['user_id'],
      where: { device_platform_id: DEVICE_PLATFORM.WEB },
      _max: { last_used_at: true },
    }),
  ]);
  const lastSeen = new Map(sessions.map((s) => [s.user_id, s._max.last_used_at]));

  const byUser = new Map<bigint, typeof rows>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

  return [...byUser.entries()].map(([userId, history]) => {
    const first = history[0]!;
    const current = history.find((r) => r.end_date === null && r.is_active);
    const shown = current ?? history[history.length - 1]!;
    const user = first[USER];
    const seen = lastSeen.get(userId) ?? null;
    const status: StaffStatus = current && user.is_active ? (seen ? 'ACTIVE' : 'INVITED') : 'DEACTIVATED';
    return {
      id: userId.toString(),
      name: user.full_name,
      email: user.email ?? '',
      countryCode: user.country.dial_code,
      mobile: user.phone.slice(user.country.dial_code.length),
      role: { code: shown.role.code as StaffRoleCode, name: shown.role.name },
      status,
      lastActiveAt: seen?.toISOString() ?? null,
      invitedBy: first[GRANTER]?.full_name ?? null,
      invitedAt: first.created_at.toISOString(),
    };
  });
};

const findStaffMember = async (userId: bigint): Promise<StaffMemberDto> => {
  const member = (await loadStaff()).find((s) => s.id === userId.toString());
  if (!member) throw new ApiError(404, 'NOT_FOUND', 'Staff member not found');
  return member;
};

export const listRoles = async (): Promise<StaffRoleDto[]> => {
  const roles = await prisma.role.findMany({
    where: { society_id: null, is_active: true, role_scope: { code: PLATFORM_SCOPE } },
    orderBy: { sort_order: 'asc' },
    select: { code: true, name: true, description: true },
  });
  return roles.map((r) => ({ code: r.code as StaffRoleCode, name: r.name, description: r.description ?? '' }));
};

interface ListParams {
  q?: string;
  role?: StaffRoleCode;
  status?: StaffStatus;
  sort: 'name' | 'role' | 'status' | 'lastActiveAt';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const listStaff = async (p: ListParams): Promise<StaffPageDto> => {
  const q = p.q?.toLowerCase();
  const matches = (await loadStaff()).filter(
    (s) =>
      (!p.role || s.role.code === p.role) &&
      (!p.status || s.status === p.status) &&
      (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)),
  );

  const key = (s: StaffMemberDto): string =>
    p.sort === 'role' ? s.role.name : p.sort === 'status' ? s.status : p.sort === 'lastActiveAt' ? (s.lastActiveAt ?? '') : s.name.toLowerCase();
  const dir = p.order === 'asc' ? 1 : -1;
  matches.sort((a, b) => key(a).localeCompare(key(b)) * dir || a.name.localeCompare(b.name));

  const start = (p.page - 1) * p.pageSize;
  return { items: matches.slice(start, start + p.pageSize), total: matches.length, page: p.page, pageSize: p.pageSize };
};

// ---------------------------------------------------------------- changing

const platformRole = async (code: StaffRoleCode) => {
  const role = await prisma.role.findFirst({
    where: { code, society_id: null, is_active: true, role_scope: { code: PLATFORM_SCOPE } },
    select: { id: true, name: true, is_super_admin: true },
  });
  if (!role) throw validationError('role', 'Unknown role');
  return role;
};

const currentAssignment = (tx: Prisma.TransactionClient | typeof prisma, userId: bigint) =>
  tx.user_platform_role.findFirst({
    where: { user_id: userId, end_date: null, is_active: true },
    select: { id: true, role: { select: { code: true, is_super_admin: true } } },
  });

// Inside a transaction that holds SUPER_ADMIN_LOCK: refuses if `userId` is the only active Super Admin left.
const assertNotLastSuperAdmin = async (tx: Prisma.TransactionClient, userId: bigint) => {
  const others = await tx.user_platform_role.count({
    where: {
      end_date: null,
      is_active: true,
      user_id: { not: userId },
      role: { is_super_admin: true, is_active: true },
      [USER]: { is_active: true },
    },
  });
  if (others === 0) throw new ApiError(409, 'LAST_SUPER_ADMIN', 'There must always be at least one Super Admin');
};

const today = () => new Date(new Date().toISOString().slice(0, 10));

const duplicate = (e: unknown): ApiError | null => {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  return String(e.meta?.target).includes('email')
    ? new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'This email already belongs to another account')
    : new ApiError(409, 'STAFF_ALREADY_EXISTS', 'This person is already Nivas staff');
};

interface InviteInput {
  name: string;
  email: string;
  countryCode: string;
  mobile: string;
  role: StaffRoleCode;
}

export const inviteStaff = async (actorId: bigint, input: InviteInput): Promise<StaffMemberDto> => {
  const country = await prisma.country.findFirst({ where: { dial_code: input.countryCode, is_active: true }, select: { id: true } });
  if (!country) throw validationError('countryCode', 'This country is not supported yet');
  const role = await platformRole(input.role);
  const phone = toE164(input.countryCode, input.mobile);

  const existing = await prisma.app_user.findUnique({ where: { phone }, select: { id: true, email: true, is_active: true } });
  const emailOwner = await prisma.app_user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } }, select: { id: true } });
  if (emailOwner && emailOwner.id !== existing?.id) {
    throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'This email already belongs to another account');
  }
  if (existing) {
    // The same person may already have the app (for example as a resident). Their account is reused as it is.
    if (existing.email && existing.email.toLowerCase() !== input.email) {
      throw new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'This mobile number already has an account with a different email');
    }
    if (!existing.is_active) throw validationError('mobile', 'This account is disabled');
    if (await currentAssignment(prisma, existing.id)) throw new ApiError(409, 'STAFF_ALREADY_EXISTS', 'This person is already Nivas staff');
  }

  let userId: bigint;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const id = existing
        ? existing.id
        : (await tx.app_user.create({ data: { full_name: input.name, phone, country_id: country.id, email: input.email }, select: { id: true } })).id;
      if (existing && !existing.email) await tx.app_user.update({ where: { id }, data: { email: input.email } });
      await tx.user_platform_role.create({ data: { user_id: id, role_id: role.id, granted_by: actorId } });
      return id;
    });
  } catch (e) {
    throw duplicate(e) ?? e;
  }

  const member = await findStaffMember(userId);
  // Delivery runs in the background; a failed email is only logged and the invite can be resent.
  sendEmail('STAFF_INVITE', member.email, { name: member.name, roleName: role.name }).catch((err) => console.error(`[staff] invite email failed for user ${userId}`, err));
  return member;
};

export const changeRole = async (actorId: bigint, staffId: string, code: StaffRoleCode): Promise<StaffMemberDto> => {
  const userId = parseId(staffId);
  await findStaffMember(userId);
  if (userId === actorId) throw new ApiError(409, 'CANNOT_CHANGE_SELF', 'You cannot change your own role');
  const role = await platformRole(code);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK})`;
    const current = await currentAssignment(tx, userId);
    if (!current) throw validationError('staffId', 'This staff member is deactivated. Reactivate them first');
    if (current.role.code === code) return;
    if (current.role.is_super_admin && !role.is_super_admin) await assertNotLastSuperAdmin(tx, userId);
    await tx.user_platform_role.update({ where: { id: current.id }, data: { end_date: today(), ended_by: actorId } });
    await tx.user_platform_role.create({ data: { user_id: userId, role_id: role.id, granted_by: actorId } });
  });
  return findStaffMember(userId);
};

export const deactivateStaff = async (actorId: bigint, staffId: string): Promise<StaffMemberDto> => {
  const userId = parseId(staffId);
  await findStaffMember(userId);
  if (userId === actorId) throw new ApiError(409, 'CANNOT_CHANGE_SELF', 'You cannot deactivate yourself');

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK})`;
    const current = await currentAssignment(tx, userId);
    if (!current) return; // already deactivated
    if (current.role.is_super_admin) await assertNotLastSuperAdmin(tx, userId);
    await tx.user_platform_role.update({ where: { id: current.id }, data: { end_date: today(), ended_by: actorId } });
    // Only the console sessions end: the same account may be a resident in the mobile app.
    await tx.auth_session.updateMany({
      where: { user_id: userId, device_platform_id: DEVICE_PLATFORM.WEB, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  });
  return findStaffMember(userId);
};

export const reactivateStaff = async (actorId: bigint, staffId: string, code?: StaffRoleCode): Promise<StaffMemberDto> => {
  const userId = parseId(staffId);
  const member = await findStaffMember(userId);
  if (member.status !== 'DEACTIVATED') return member;

  const user = await prisma.app_user.findUnique({ where: { id: userId }, select: { is_active: true } });
  if (!user?.is_active) throw validationError('staffId', 'This account is disabled');
  const role = await platformRole(code ?? member.role.code);
  try {
    await prisma.user_platform_role.create({ data: { user_id: userId, role_id: role.id, granted_by: actorId } });
  } catch (e) {
    throw duplicate(e) ?? e;
  }
  return findStaffMember(userId);
};

// One invitation email per person per minute. Kept in memory: enough to stop a double click or a loop, and a restart only resets it.
const lastInviteSent = new Map<string, number>();

export const resendInvite = async (staffId: string): Promise<void> => {
  const userId = parseId(staffId);
  const member = await findStaffMember(userId);
  if (member.status !== 'INVITED') throw new ApiError(409, 'REQUEST_NOT_PENDING', 'This person has already signed in');

  const wait = Math.ceil(((lastInviteSent.get(member.id) ?? 0) + RESEND_INVITE_AFTER_MS - Date.now()) / 1000);
  if (wait > 0) throw new ApiError(429, 'RATE_LIMITED', `Please wait ${wait}s before resending the invite`, undefined, wait);
  lastInviteSent.set(member.id, Date.now());
  sendEmail('STAFF_INVITE', member.email, { name: member.name, roleName: member.role.name }).catch((err) => console.error(`[staff] invite email failed for user ${userId}`, err));
};
