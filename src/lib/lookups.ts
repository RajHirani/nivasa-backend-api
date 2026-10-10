import { ApiError } from '../utils/api-error.js';
import { prisma } from './prisma.js';
import { CACHE_KEYS, cached } from './static-cache.js';

// code → id of the small lookup tables, read once (cleared with the other static data).
export const lookups = () =>
  cached(CACHE_KEYS.LOOKUPS, async () => {
    const byCode = (rows: { id: number; code: string }[]) => new Map(rows.map((r) => [r.code, r.id]));
    const [role, relation, occupancy, requestStatus, memberStatus] = await Promise.all([
      prisma.resident_role.findMany({ select: { id: true, code: true } }),
      prisma.resident_relation.findMany({ select: { id: true, code: true } }),
      prisma.occupancy_status.findMany({ select: { id: true, code: true } }),
      prisma.request_status.findMany({ select: { id: true, code: true } }),
      prisma.member_status.findMany({ select: { id: true, code: true } }),
    ]);
    return {
      role: byCode(role),
      relation: byCode(relation),
      occupancy: byCode(occupancy),
      requestStatus: byCode(requestStatus),
      memberStatus: byCode(memberStatus),
    };
  });

export const idOf = (ids: Map<string, number>, code: string): number => {
  const id = ids.get(code);
  if (id === undefined) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return id;
};
