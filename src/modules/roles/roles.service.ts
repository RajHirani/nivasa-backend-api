import { prisma } from '../../lib/prisma.js';

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  builtIn: boolean;
}

// Roles a committee member can be given in this society: the built-in society roles and the society's own custom roles
// (RESIDENT and platform roles are not assignable). In display order.
export const listAssignableRoles = async (societyId: bigint): Promise<RoleDto[]> => {
  const rows = await prisma.role.findMany({
    where: { is_active: true, is_assignable: true, role_scope: { code: 'SOCIETY' }, OR: [{ society_id: null }, { society_id: societyId }] },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, society_id: true },
  });
  return rows.map((r) => ({ id: r.id.toString(), code: r.code, name: r.name, builtIn: r.society_id === null }));
};
