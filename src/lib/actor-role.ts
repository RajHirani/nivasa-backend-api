import type { Prisma } from '@prisma/client';

// The role the actor holds in this society today (the one listed first), kept with the event, comment or notice so the history
// stays right after a term change. NULL for someone without a society role: a resident.
export const actorRoleId = async (tx: Prisma.TransactionClient, societyId: bigint, userId: bigint): Promise<number | null> => {
  const rows = await tx.user_society_role.findMany({
    where: { society_id: societyId, user_id: userId, end_date: null, is_active: true, role: { is_active: true } },
    select: { role: { select: { id: true, sort_order: true } } },
  });
  return rows.sort((a, b) => a.role.sort_order - b.role.sort_order)[0]?.role.id ?? null;
};
