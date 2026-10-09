import { prisma } from './prisma.js';

export interface RoleRef {
  code: string;
  name: string;
}

export interface SocietyAccess {
  roles: RoleRef[];
  permissions: string[];
}

const today = () => new Date(new Date().toISOString().slice(0, 10));

// Roles and permissions of a user inside each given society (the caller has already established active membership).
// permissions = platform roles ∪ the society's roles ∪ RESIDENT's permissions when the user has a current home there.
// A super admin role (PLATFORM_ADMIN) gets every society permission. RESIDENT is derived, never stored in user_role.
export const loadAccess = async (
  userId: bigint,
  societyIds: bigint[],
  residentSocietyIds: Set<bigint>,
): Promise<Map<bigint, SocietyAccess>> => {
  const result = new Map<bigint, SocietyAccess>();
  if (societyIds.length === 0) return result;

  const [assignments, residentRole, allPermissions] = await Promise.all([
    prisma.user_role.findMany({
      where: {
        user_id: userId,
        role: { is_active: true },
        AND: [
          { OR: [{ end_date: null }, { end_date: { gte: today() } }] },
          { OR: [{ society_id: null }, { society_id: { in: societyIds } }] },
        ],
      },
      select: {
        society_id: true,
        role: {
          select: {
            id: true,
            code: true,
            name: true,
            sort_order: true,
            is_super_admin: true,
            role_permission: { select: { permission: { select: { code: true, is_active: true } } } },
          },
        },
      },
    }),
    prisma.role.findFirst({
      where: { code: 'RESIDENT', society_id: null },
      select: {
        id: true,
        code: true,
        name: true,
        sort_order: true,
        role_permission: { select: { permission: { select: { code: true, is_active: true } } } },
      },
    }),
    prisma.permission.findMany({ where: { is_active: true }, select: { code: true } }),
  ]);

  const platform = assignments.filter((a) => a.society_id === null).map((a) => a.role);
  const superAdmin = platform.some((r) => r.is_super_admin);

  for (const societyId of societyIds) {
    const roles = new Map<number, { code: string; name: string; sort_order: number }>();
    const permissions = new Set<string>();
    const grant = (r: { role_permission: { permission: { code: string; is_active: boolean } }[] }) => {
      for (const rp of r.role_permission) if (rp.permission.is_active) permissions.add(rp.permission.code);
    };

    platform.forEach(grant);
    for (const a of assignments) {
      if (a.society_id !== societyId) continue;
      roles.set(a.role.id, a.role);
      grant(a.role);
    }
    if (residentRole && residentSocietyIds.has(societyId)) {
      roles.set(residentRole.id, residentRole);
      grant(residentRole);
    }
    if (superAdmin) allPermissions.forEach((p) => permissions.add(p.code));

    result.set(societyId, {
      roles: [...roles.values()].sort((a, b) => a.sort_order - b.sort_order).map(({ code, name }) => ({ code, name })),
      permissions: [...permissions].sort(),
    });
  }
  return result;
};
