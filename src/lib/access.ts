import { prisma } from './prisma.js';

export interface RoleRef {
  code: string;
  name: string;
}

export interface SocietyAccess {
  roles: RoleRef[];
  permissions: string[];
}


// Roles and permissions of a user inside each given society (the caller has already established active membership).
// permissions = the society's roles ∪ RESIDENT's permissions when the user has a current home there.
// Platform roles (Nivas staff, user_platform_role) never count here: staff who live in a society get resident rights only.
// RESIDENT is derived, never stored in user_society_role.
export const loadAccess = async (
  userId: bigint,
  societyIds: bigint[],
  residentSocietyIds: Set<bigint>,
): Promise<Map<bigint, SocietyAccess>> => {
  const result = new Map<bigint, SocietyAccess>();
  if (societyIds.length === 0) return result;

  const [assignments, residentRole] = await Promise.all([
    prisma.user_society_role.findMany({
      where: {
        user_id: userId,
        is_active: true,
        end_date: null,
        role: { is_active: true },
        society_id: { in: societyIds },
      },
      select: {
        society_id: true,
        role: {
          select: {
            id: true,
            code: true,
            name: true,
            sort_order: true,
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
  ]);

  for (const societyId of societyIds) {
    const roles = new Map<number, { code: string; name: string; sort_order: number }>();
    const permissions = new Set<string>();
    const grant = (r: { role_permission: { permission: { code: string; is_active: boolean } }[] }) => {
      for (const rp of r.role_permission) if (rp.permission.is_active) permissions.add(rp.permission.code);
    };

    for (const a of assignments) {
      if (a.society_id !== societyId) continue;
      roles.set(a.role.id, a.role);
      grant(a.role);
    }
    if (residentRole && residentSocietyIds.has(societyId)) {
      roles.set(residentRole.id, residentRole);
      grant(residentRole);
    }

    result.set(societyId, {
      roles: [...roles.values()].sort((a, b) => a.sort_order - b.sort_order).map(({ code, name }) => ({ code, name })),
      permissions: [...permissions].sort(),
    });
  }
  return result;
};
