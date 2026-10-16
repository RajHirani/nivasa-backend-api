import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { getSocietyDetail } from './platform-societies.service.js';
import type { SocietyDetailDto } from './platform-societies.types.js';

// Deactivate / reactivate. Asking for the state the society is already in is not an error and writes nothing (no repeated activity entry).
const change = async (societyId: bigint, actorId: bigint, active: boolean, reason?: string): Promise<SocietyDetailDto> => {
  await prisma.$transaction(async (tx) => {
    if (!(await tx.society.findUnique({ where: { id: societyId }, select: { id: true } }))) throw new ApiError(404, 'NOT_FOUND', 'Society not found');
    // The condition makes two staff pressing the button together produce one entry.
    const { count } = await tx.society.updateMany({ where: { id: societyId, is_active: !active }, data: { is_active: active, updated_at: new Date() } });
    if (count === 0) return;
    const type = await tx.society_activity_type.findUniqueOrThrow({ where: { code: active ? 'REACTIVATED' : 'DEACTIVATED' }, select: { id: true } });
    await tx.society_activity.create({
      data: { society_id: societyId, activity_type_id: type.id, actor_id: actorId, summary: active ? 'Society reactivated' : 'Society deactivated', note: active ? null : (reason ?? null) },
    });
  });
  return getSocietyDetail(societyId);
};

export const deactivateSociety = (societyId: bigint, actorId: bigint, reason?: string) => change(societyId, actorId, false, reason);
export const reactivateSociety = (societyId: bigint, actorId: bigint) => change(societyId, actorId, true);
