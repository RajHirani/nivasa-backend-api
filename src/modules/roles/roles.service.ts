import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { today } from '../../lib/committee-term.js';
import { ApiError, type ErrorCode } from '../../utils/api-error.js';
import type { CreateRoleInput } from './roles.schema.js';

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  builtIn: boolean;
}

export interface RoleDetailDto extends RoleDto {
  description: string | null;
  assignable: boolean; // false for RESIDENT: derived from a home, shown on the Roles screen only
  memberCount: number | null; // null for RESIDENT
  permissions: string[]; // permission codes
}

export interface PermissionDto {
  code: string;
  name: string;
  module: string; // the group in the role editor
}

const fieldError = (status: number, code: ErrorCode, field: string, message: string) => new ApiError(status, code, message, [{ field, message }]);

// Society-scope roles this society can see: the built-in ones and its own custom roles (not deleted).
const societyRoles = (societyId: bigint) => ({ is_active: true, role_scope: { code: 'SOCIETY' }, OR: [{ society_id: null }, { society_id: societyId }] });

// Roles a committee member can be given in this society: the built-in society roles and the society's own custom roles
// (RESIDENT and platform roles are not assignable). In display order.
export const listAssignableRoles = async (societyId: bigint): Promise<RoleDto[]> => {
  const rows = await prisma.role.findMany({
    where: { ...societyRoles(societyId), is_assignable: true },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, society_id: true },
  });
  return rows.map((r) => ({ id: r.id.toString(), code: r.code, name: r.name, builtIn: r.society_id === null }));
};

// `withResident` adds the derived RESIDENT role (the Roles screen shows it read-only; nothing else does).
const loadDetails = async (societyId: bigint, only?: number, withResident = false): Promise<RoleDetailDto[]> => {
  const rows = await prisma.role.findMany({
    where: {
      AND: [
        societyRoles(societyId),
        only === undefined ? {} : { id: only },
        withResident ? { OR: [{ is_assignable: true }, { code: 'RESIDENT', society_id: null }] } : { is_assignable: true },
      ],
    },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: {
      id: true, code: true, name: true, description: true, society_id: true, is_assignable: true,
      role_permission: { where: { permission: { is_active: true } }, select: { permission: { select: { code: true } } } },
    },
  });
  const counts = await prisma.user_society_role.groupBy({
    by: ['role_id'],
    where: { society_id: societyId, end_date: null, is_active: true, role_id: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const members = new Map(counts.map((c) => [c.role_id, c._count._all]));
  const detail = rows.map((r) => ({
    id: r.id.toString(),
    code: r.code,
    name: r.name,
    builtIn: r.society_id === null,
    description: r.description,
    assignable: r.is_assignable,
    memberCount: r.is_assignable ? (members.get(r.id) ?? 0) : null,
    permissions: r.role_permission.map((rp) => rp.permission.code).sort(),
  }));
  // built-in roles first in their own order, then the society's roles by name
  return only === undefined ? [...detail.filter((r) => r.builtIn), ...detail.filter((r) => !r.builtIn)] : detail;
};

const catalogue = async (): Promise<PermissionDto[]> => {
  const rows = await prisma.permission.findMany({
    where: { is_active: true, role_scope: { code: 'SOCIETY' } },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    select: { code: true, name: true, module: true },
  });
  return rows;
};

// The Roles screen: every assignable role with its permissions and holders, and the permission catalogue.
export const overview = async (societyId: bigint): Promise<{ roles: RoleDetailDto[]; permissions: PermissionDto[] }> => {
  const [roles, permissions] = await Promise.all([loadDetails(societyId, undefined, true), catalogue()]);
  return { roles, permissions };
};

// Case-insensitive name check against the roles this society sees (built-in names count).
const requireFreeName = async (tx: Prisma.TransactionClient, societyId: bigint, name: string, exceptId?: number) => {
  const taken = await tx.role.findMany({ where: { ...societyRoles(societyId), ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  const wanted = name.trim().toLowerCase();
  if (taken.some((r) => r.name.trim().toLowerCase() === wanted)) throw fieldError(409, 'ROLE_NAME_TAKEN', 'name', 'A role with this name already exists');
};

// A custom role of this society (built-in roles are locked).
const customRole = async (tx: Prisma.TransactionClient, societyId: bigint, roleId: number) => {
  const role = await tx.role.findFirst({ where: { id: roleId, is_active: true, role_scope: { code: 'SOCIETY' }, OR: [{ society_id: null }, { society_id: societyId }] }, select: { id: true, name: true, society_id: true } });
  if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
  if (role.society_id === null) throw new ApiError(409, 'ROLE_LOCKED', 'Default roles are locked. Duplicate the role to make your own version.');
  return role;
};

export const createRole = async (societyId: bigint, actorId: bigint, input: CreateRoleInput): Promise<RoleDetailDto> => {
  const id = await prisma.$transaction(async (tx) => {
    await requireFreeName(tx, societyId, input.name);
    let codes: string[] = [];
    if (input.copyFromRoleId) {
      const source = await tx.role.findFirst({
        where: { id: Number(input.copyFromRoleId), is_assignable: true, ...societyRoles(societyId) },
        select: { role_permission: { where: { permission: { is_active: true } }, select: { permission: { select: { code: true } } } } },
      });
      if (!source) throw fieldError(400, 'VALIDATION_FAILED', 'copyFromRoleId', 'Choose a role to start from');
      codes = source.role_permission.map((rp) => rp.permission.code);
    }
    const scope = await tx.role_scope.findFirstOrThrow({ where: { code: 'SOCIETY' }, select: { id: true } });
    // Custom ids come from the same sequence as every role; the code is generated from the id, so a deleted role never blocks a new one.
    const seq = await tx.$queryRaw<{ id: number }[]>`SELECT nextval('role_id_seq')::int AS id`;
    const newId = seq[0]!.id;
    const created = await tx.role.create({
      data: { id: newId, code: `CUSTOM_${newId}`, name: input.name, description: input.description || null, role_scope_id: scope.id, society_id: societyId, is_assignable: true, sort_order: 1001, created_by: actorId },
      select: { id: true },
    });
    if (codes.length) {
      const perms = await tx.permission.findMany({ where: { code: { in: codes }, is_active: true }, select: { id: true } });
      await tx.role_permission.createMany({ data: perms.map((p) => ({ role_id: created.id, permission_id: p.id })) });
    }
    return created.id;
  }).catch((e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw fieldError(409, 'ROLE_NAME_TAKEN', 'name', 'A role with this name already exists');
    throw e;
  });
  const [role] = await loadDetails(societyId, id);
  if (!role) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return role;
};

// Replaces the permissions of a custom role. Whoever holds ROLE_MANAGE may give any society permission.
export const savePermissions = async (societyId: bigint, roleId: number, wanted: string[]): Promise<RoleDetailDto> => {
  await prisma.$transaction(async (tx) => {
    const role = await customRole(tx, societyId, roleId);
    const perms = await tx.permission.findMany({ where: { is_active: true, role_scope: { code: 'SOCIETY' } }, select: { id: true, code: true } });
    const known = new Map(perms.map((p) => [p.code, p.id]));
    const unknown = wanted.find((c) => !known.has(c));
    if (unknown) throw fieldError(400, 'VALIDATION_FAILED', 'permissions', `Unknown permission ${unknown}`);

    const current = await tx.role_permission.findMany({ where: { role_id: role.id }, select: { permission: { select: { code: true } } } });
    const had = new Set(current.map((c) => c.permission.code));
    const next = new Set(wanted);

    const removed = [...had].filter((c) => !next.has(c)).map((c) => known.get(c)).filter((v): v is number => v !== undefined);
    const added = [...next].filter((c) => !had.has(c)).map((c) => known.get(c)!);
    if (removed.length) await tx.role_permission.deleteMany({ where: { role_id: role.id, permission_id: { in: removed } } });
    if (added.length) await tx.role_permission.createMany({ data: added.map((permission_id) => ({ role_id: role.id, permission_id })) });
    await tx.role.update({ where: { id: role.id }, data: { updated_at: new Date() } });
  });
  const [role] = await loadDetails(societyId, roleId);
  if (!role) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return role;
};

// Soft delete. The holders move to another role first (their rows keep the committee term); a holder who already has
// that role just loses the old one.
export const deleteRole = async (societyId: bigint, actorId: bigint, roleId: number, moveToRoleId: number | null): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const role = await customRole(tx, societyId, roleId);
    const holders = await tx.user_society_role.findMany({
      where: { society_id: societyId, role_id: role.id, end_date: null, is_active: true },
      select: { id: true, user_id: true, term_id: true },
    });
    if (holders.length > 0) {
      if (!moveToRoleId || moveToRoleId === role.id) throw fieldError(400, 'VALIDATION_FAILED', 'moveToRoleId', 'Pick the role to move the members to');
      const target = await tx.role.findFirst({ where: { id: moveToRoleId, is_assignable: true, ...societyRoles(societyId) }, select: { id: true } });
      if (!target) throw fieldError(400, 'VALIDATION_FAILED', 'moveToRoleId', 'Pick the role to move the members to');

      const already = new Set((await tx.user_society_role.findMany({ where: { society_id: societyId, role_id: target.id, end_date: null, is_active: true }, select: { user_id: true } })).map((r) => r.user_id));
      await tx.user_society_role.updateMany({ where: { id: { in: holders.map((h) => h.id) } }, data: { end_date: today(), ended_by: actorId, updated_at: new Date() } });
      const moving = holders.filter((h) => !already.has(h.user_id));
      if (moving.length) {
        await tx.user_society_role.createMany({ data: moving.map((h) => ({ user_id: h.user_id, role_id: target.id, society_id: societyId, term_id: h.term_id, granted_by: actorId })) });
      }
    }
    // the role keeps its name and permissions for the history of closed terms
    await tx.role.update({ where: { id: role.id }, data: { is_active: false, updated_at: new Date() } });
  });
};
