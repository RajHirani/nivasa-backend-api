import { prisma } from './prisma.js';

export interface PlatformAccess {
  role: { code: string; name: string };
  permissions: string[];
}

const PLATFORM_SCOPE = 'PLATFORM';

// The platform role of a Nivas staff member (null when they have none) and the platform permissions it grants.
// A super admin role gets every active platform permission. Platform roles work only on the platform console;
// they are never consulted for society access (see loadAccess).
export const loadPlatformAccess = async (userId: bigint): Promise<PlatformAccess | null> => {
  const assignment = await prisma.user_platform_role.findFirst({
    where: { user_id: userId, is_active: true, end_date: null, role: { is_active: true } },
    select: {
      role: {
        select: {
          code: true,
          name: true,
          is_super_admin: true,
          role_permission: { select: { permission: { select: { code: true, is_active: true } } } },
        },
      },
    },
  });
  if (!assignment) return null;

  const { role } = assignment;
  const codes = role.is_super_admin
    ? (await prisma.permission.findMany({
      where: { is_active: true, role_scope: { code: PLATFORM_SCOPE } },
      select: { code: true },
    })).map((p) => p.code)
    : role.role_permission.filter((rp) => rp.permission.is_active).map((rp) => rp.permission.code);

  return { role: { code: role.code, name: role.name }, permissions: [...new Set(codes)].sort() };
};
