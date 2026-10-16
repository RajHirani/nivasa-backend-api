import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import type { SocietyModuleDto } from './platform-societies.types.js';

// Switch one module on or off for a society (Modules tab). A module with no row counts as on, so switching it on writes nothing;
// switching it off creates the row. Asking for the state it already has changes nothing and writes no Activity entry.
export const setSocietyModule = async (societyId: bigint, actorId: bigint, code: string, enabled: boolean): Promise<SocietyModuleDto> => {
  const module = await prisma.module.findFirst({ where: { code: code.toUpperCase(), is_active: true }, select: { id: true, code: true, name: true, description: true } });
  if (!module) throw new ApiError(404, 'NOT_FOUND', 'Module not found');

  await prisma.$transaction(async (tx) => {
    if (!(await tx.society.findUnique({ where: { id: societyId }, select: { id: true } }))) throw new ApiError(404, 'NOT_FOUND', 'Society not found');
    const row = await tx.society_module.findUnique({ where: { society_id_module_id: { society_id: societyId, module_id: module.id } }, select: { is_enabled: true } });
    if ((row?.is_enabled ?? true) === enabled) return;
    const now = new Date();
    await tx.society_module.upsert({
      where: { society_id_module_id: { society_id: societyId, module_id: module.id } },
      create: { society_id: societyId, module_id: module.id, is_enabled: enabled, updated_by: actorId },
      update: { is_enabled: enabled, updated_by: actorId, updated_at: now },
    });
    const type = await tx.society_activity_type.findUniqueOrThrow({ where: { code: 'MODULE_CHANGED' }, select: { id: true } });
    await tx.society_activity.create({
      data: { society_id: societyId, activity_type_id: type.id, actor_id: actorId, summary: `${module.name} turned ${enabled ? 'on' : 'off'}` },
    });
  });
  return { code: module.code, name: module.name, description: module.description ?? '', enabled };
};
