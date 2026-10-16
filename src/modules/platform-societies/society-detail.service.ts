import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import type { ActivityPageDto, SocietyAdminDto, SocietyModuleDto, SocietyType, StructureDto, UnitDto } from './platform-societies.types.js';

// The read-only tabs of the society page: structure, admins, modules and activity.

/** The id from the URL; anything that cannot be an id is simply "not found". */
export const parseSocietyId = (raw: string): bigint => {
  if (!/^[0-9]{1,18}$/.test(raw)) throw new ApiError(404, 'NOT_FOUND', 'Society not found');
  return BigInt(raw);
};

const assertSociety = async (societyId: bigint): Promise<{ type: SocietyType }> => {
  const s = await prisma.society.findUnique({ where: { id: societyId }, select: { society_type: { select: { code: true } } } });
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Society not found');
  return { type: s.society_type.code as SocietyType };
};

// ---------------------------------------------------------------- structure

interface StructureRow {
  id: bigint;
  parent_id: bigint | null;
  kind: string;
  identifier: string;
  floor_number: number | null;
  occupied: boolean;
}

// Buildings, floors and units in the order they were created. A unit is occupied when somebody lives there now or has a pending
// home request for it (those units can be renamed but never removed).
export const getStructure = async (societyId: bigint): Promise<StructureDto> => {
  const { type } = await assertSociety(societyId);
  const rows = await prisma.$queryRaw<StructureRow[]>`
    SELECT x.id, x.parent_id, t.code AS kind, x.identifier, x.floor_number,
      (t.is_unit AND (
        EXISTS (SELECT 1 FROM user_resident_map m WHERE m.unit_id = x.id AND m.move_out_date IS NULL AND m.is_active)
        OR EXISTS (SELECT 1 FROM home_request h JOIN request_status rs ON rs.id = h.request_status_id
                   WHERE h.unit_id = x.id AND rs.code = 'PENDING')
      )) AS occupied
    FROM structure x JOIN structure_type t ON t.id = x.structure_type_id
    WHERE x.society_id = ${societyId} AND x.is_active
    ORDER BY x.sort_order, x.id`;

  const unit = (r: StructureRow): UnitDto => ({ id: r.id.toString(), number: r.identifier, occupied: r.occupied });
  const childrenOf = new Map<bigint, StructureRow[]>();
  for (const r of rows) if (r.parent_id !== null) childrenOf.set(r.parent_id, [...(childrenOf.get(r.parent_id) ?? []), r]);

  const buildings = rows
    .filter((r) => r.parent_id === null)
    .map((b) => {
      const kids = childrenOf.get(b.id) ?? [];
      if (type === 'APARTMENT') {
        const floors = kids
          .filter((k) => k.kind === 'FLOOR')
          .map((f) => ({ number: f.floor_number ?? 0, flats: (childrenOf.get(f.id) ?? []).map(unit) }));
        return { id: b.id.toString(), name: b.identifier, unitCount: floors.reduce((n, f) => n + f.flats.length, 0), floors };
      }
      const houses = kids.map(unit);
      return { id: b.id.toString(), name: b.identifier, unitCount: houses.length, houses };
    });
  return { type, buildings };
};

// ---------------------------------------------------------------- admins

// "Admins" are the people who currently hold the President role; the longest-serving is the first admin.
export const listAdmins = async (societyId: bigint): Promise<SocietyAdminDto[]> => {
  const rows = await prisma.$queryRaw<{ id: bigint; full_name: string; phone: string; dial_code: string; email: string | null; terms: Date | null; since: Date }[]>`
    SELECT u.id, u.full_name, u.phone, c.dial_code, u.email, u.terms_accepted_at AS terms, usr.start_date AS since
    FROM user_society_role usr
    JOIN role r ON r.id = usr.role_id AND r.code = 'PRESIDENT' AND r.society_id IS NULL
    JOIN app_user u ON u.id = usr.user_id
    JOIN country c ON c.id = u.country_id
    WHERE usr.society_id = ${societyId} AND usr.end_date IS NULL AND usr.is_active
    ORDER BY usr.id`;
  return rows.map((a, i) => ({
    userId: a.id.toString(),
    name: a.full_name,
    countryCode: a.dial_code,
    mobile: a.phone.slice(a.dial_code.length),
    email: a.email,
    status: a.terms ? 'ACTIVE' : 'INVITED',
    isFirstAdmin: i === 0,
    since: a.since.toISOString().slice(0, 10),
  }));
};

export const getAdmins = async (societyId: bigint): Promise<{ items: SocietyAdminDto[] }> => {
  await assertSociety(societyId);
  return { items: await listAdmins(societyId) };
};

// ---------------------------------------------------------------- modules

// Every module of the catalogue; one with no row for this society counts as on (the default).
export const listModules = async (societyId: bigint): Promise<{ items: SocietyModuleDto[] }> => {
  await assertSociety(societyId);
  const rows = await prisma.$queryRaw<{ code: string; name: string; description: string | null; enabled: boolean }[]>`
    SELECT m.code, m.name, m.description, COALESCE(sm.is_enabled, TRUE) AS enabled
    FROM module m LEFT JOIN society_module sm ON sm.module_id = m.id AND sm.society_id = ${societyId}
    WHERE m.is_active ORDER BY m.sort_order, m.id`;
  return { items: rows.map((m) => ({ code: m.code, name: m.name, description: m.description ?? '', enabled: m.enabled })) };
};

// ---------------------------------------------------------------- activity

export const listActivity = async (societyId: bigint, page: number, pageSize: number): Promise<ActivityPageDto> => {
  await assertSociety(societyId);
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<{ id: bigint; type: string; summary: string; note: string | null; by: string | null; by_role: string | null; created_at: Date }[]>`
      SELECT a.id, t.code AS type, a.summary, a.note, u.full_name AS by, pr.role_name AS by_role, a.created_at
      FROM society_activity a
      JOIN society_activity_type t ON t.id = a.activity_type_id
      LEFT JOIN app_user u ON u.id = a.actor_id
      LEFT JOIN LATERAL (
        SELECT r.name AS role_name FROM user_platform_role upr JOIN role r ON r.id = upr.role_id
        WHERE upr.user_id = a.actor_id AND upr.end_date IS NULL AND upr.is_active LIMIT 1
      ) pr ON TRUE
      WHERE a.society_id = ${societyId}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.society_activity.count({ where: { society_id: societyId } }),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id.toString(), type: r.type, summary: r.summary, note: r.note, by: r.by, byRole: r.by_role, createdAt: r.created_at.toISOString() })),
    total,
    page,
    pageSize,
  };
};
