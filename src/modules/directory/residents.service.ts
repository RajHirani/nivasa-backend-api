import { Prisma } from '@prisma/client';
import { buildingDto, flatDto, unitInclude } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import type { DirectorySummaryDto, OccupancyStatusDto, ResidentRowDto } from './directory.types.js';

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const likeSafe = (s: string) => s.replace(/[\\%_]/g, '\\$&');

interface Filters {
  page: number;
  pageSize: number;
  q?: string | undefined;
  buildingId?: string | undefined;
  occupancyId?: string | undefined;
}

const currentHomes = (societyId: bigint, f: Pick<Filters, 'q' | 'buildingId' | 'occupancyId'>): Prisma.user_resident_mapWhereInput => {
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, '');
  return {
    society_id: societyId,
    move_out_date: null,
    is_active: true,
    ...(f.occupancyId && { occupancy_status_id: Number(f.occupancyId) }),
    structure: { is_active: true, ...(f.buildingId && { building_id: BigInt(f.buildingId) }) },
    ...(q && {
      OR: [
        { app_user: { full_name: { contains: likeSafe(q), mode: 'insensitive' } } },
        { structure: { identifier: { contains: likeSafe(q), mode: 'insensitive' } } },
        ...(digits ? [{ app_user: { phone: { contains: digits } } }] : []),
      ],
    }),
  };
};

// Residents tab: every current home of the society, all occupancy statuses, one row per home, sorted by block, flat, then
// owner first. Filtered and counted by the database, ordered naturally (A-2 before A-10) here.
export const listResidents = async (societyId: bigint, f: Filters): Promise<{ items: ResidentRowDto[]; total: number }> => {
  const rows = await prisma.user_resident_map.findMany({
    where: currentHomes(societyId, f),
    select: {
      id: true,
      app_user: { select: { full_name: true, phone: true, country: { select: { dial_code: true } } } },
      resident_relation: { select: { label: true, sort_order: true } },
      occupancy_status: { select: { id: true, code: true, name: true } },
      structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
    },
  });
  const sorted = rows
    .map((r) => {
      const building = buildingDto(r.structure)?.name ?? '';
      const code = flatDto(r.structure).code;
      return { r, building, code };
    })
    .sort((a, b) => natural(a.building, b.building) || natural(a.code, b.code) || a.r.resident_relation.sort_order - b.r.resident_relation.sort_order || a.r.app_user.full_name.localeCompare(b.r.app_user.full_name));
  const items = sorted.slice(f.page * f.pageSize, (f.page + 1) * f.pageSize).map(({ r, building, code }) => {
    const dial = r.app_user.country.dial_code;
    return {
      id: r.id.toString(),
      name: r.app_user.full_name,
      relation: r.resident_relation.label,
      block: building,
      flat: building ? `${building}-${code}` : code,
      occupancy: { id: r.occupancy_status.id.toString(), code: r.occupancy_status.code, name: r.occupancy_status.name },
      countryCode: dial,
      mobile: r.app_user.phone.slice(dial.length),
    };
  });
  return { items, total: sorted.length };
};

// Occupancy statuses for the Residents filter (from the database, in display order).
export const listOccupancyStatuses = async (): Promise<OccupancyStatusDto[]> =>
  (await prisma.occupancy_status.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, code: true, name: true } })).map((o) => ({
    id: o.id.toString(),
    code: o.code,
    name: o.name,
  }));

// The five tab counts, each one a COUNT query (no rows are loaded). Residents are rows (a person in two homes counts twice);
// guards are the society's guard contacts plus the Security role holders whose
// phone is not already a guard contact (the list shows each number once).
export const summary = async (societyId: bigint, guardRoleCodes: string[]): Promise<DirectorySummaryDto> => {
  const [residents, committee, services, emergency, guards] = await Promise.all([
    prisma.user_resident_map.count({ where: currentHomes(societyId, {}) }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT r.user_id)::int AS n
      FROM user_society_role r JOIN committee_term t ON t.id = r.term_id AND t.closed_at IS NULL
      WHERE r.society_id = ${societyId} AND r.end_date IS NULL AND r.is_active`.then((r) => r[0]?.n ?? 0),
    prisma.service_provider.count({ where: { society_id: societyId, is_active: true } }),
    prisma.society_contact.count({ where: { society_id: societyId, is_active: true, contact_category: { code: 'EMERGENCY' } } }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT (
        (SELECT COUNT(*) FROM society_contact c JOIN contact_category k ON k.id = c.contact_category_id AND k.code = 'GUARD'
          WHERE c.society_id = ${societyId} AND c.is_active)
        +
        (SELECT COUNT(*) FROM user_society_role r
          JOIN role ro ON ro.id = r.role_id AND ro.is_active AND ro.code IN (${Prisma.join(guardRoleCodes)})
          JOIN app_user a ON a.id = r.user_id AND a.is_active
          WHERE r.society_id = ${societyId} AND r.end_date IS NULL AND r.is_active
            AND NOT EXISTS (SELECT 1 FROM user_society_map sm JOIN member_status ms ON ms.id = sm.member_status_id AND ms.code = 'INACTIVE'
                            WHERE sm.user_id = r.user_id AND sm.society_id = r.society_id AND sm.left_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM society_contact c JOIN contact_category k ON k.id = c.contact_category_id AND k.code = 'GUARD'
                            WHERE c.society_id = r.society_id AND c.is_active AND c.phone = a.phone))
      )::int AS n`.then((r) => r[0]?.n ?? 0),
  ]);
  return { residents, committee, services, emergency, guards };
};
