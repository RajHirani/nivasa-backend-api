import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/api-error.js';
import { storage } from '../../lib/storage/index.js';
import { listAdmins } from './society-detail.service.js';
import type { ListSocietiesParams } from './platform-societies.schema.js';
import type { DashboardDto, SocietyDetailDto, SocietyPageDto, SocietySummaryDto, SocietyType } from './platform-societies.types.js';

// The list joins societies with their city and state, their first admin and their number of flats/houses, then filters,
// sorts and pages in the database, so it stays quick with thousands of societies. Plain SQL is clearer than Prisma here.

// "First admin" = the longest-serving current President of the society.
const FROM = Prisma.sql`
  FROM society s
  JOIN society_type st ON st.id = s.society_type_id
  JOIN city c ON c.id = s.city_id
  JOIN state stt ON stt.id = c.state_id
  LEFT JOIN LATERAL (
    SELECT u.full_name, u.phone, u.country_id
    FROM user_society_role usr
    JOIN role r ON r.id = usr.role_id AND r.code = 'PRESIDENT' AND r.society_id IS NULL
    JOIN app_user u ON u.id = usr.user_id
    WHERE usr.society_id = s.id AND usr.end_date IS NULL AND usr.is_active
    ORDER BY usr.id
    LIMIT 1
  ) a ON TRUE
  LEFT JOIN country ac ON ac.id = a.country_id`;

const UNIT_COUNT = Prisma.sql`(
  SELECT count(*) FROM structure x JOIN structure_type xt ON xt.id = x.structure_type_id
  WHERE x.society_id = s.id AND x.is_active AND xt.is_unit
)`;

// Sort keys are mapped to SQL here, never taken from the request as text.
const ORDER_BY: Record<ListSocietiesParams['sort'], Prisma.Sql> = {
  name: Prisma.sql`lower(s.name)`,
  city: Prisma.sql`lower(c.name)`,
  type: Prisma.sql`st.code`,
  status: Prisma.sql`s.is_active`,
  units: Prisma.sql`unit_count`,
  createdAt: Prisma.sql`s.created_at`,
};

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (ch) => `\\${ch}`);

interface Row {
  id: bigint;
  name: string;
  type: string;
  is_active: boolean;
  city: string;
  state: string;
  created_at: Date;
  admin_name: string | null;
  admin_phone: string | null;
  admin_dial: string | null;
  unit_count: bigint;
}

const toDto = (r: Row): SocietySummaryDto => ({
  id: r.id.toString(),
  name: r.name,
  type: r.type as SocietyType,
  status: r.is_active ? 'ACTIVE' : 'INACTIVE',
  city: r.city,
  state: r.state,
  firstAdmin: r.admin_name
    ? { name: r.admin_name, countryCode: r.admin_dial ?? '', mobile: r.admin_phone?.slice((r.admin_dial ?? '').length) ?? '' }
    : null,
  unitCount: Number(r.unit_count),
  createdAt: r.created_at.toISOString(),
});

export const listSocieties = async (p: ListSocietiesParams): Promise<SocietyPageDto> => {
  const where: Prisma.Sql[] = [];
  if (p.q) {
    const pattern = `%${escapeLike(p.q)}%`;
    where.push(Prisma.sql`(s.name ILIKE ${pattern} OR c.name ILIKE ${pattern} OR a.full_name ILIKE ${pattern})`);
  }
  if (p.type) where.push(Prisma.sql`st.code = ${p.type}`);
  if (p.status) where.push(p.status === 'ACTIVE' ? Prisma.sql`s.is_active` : Prisma.sql`NOT s.is_active`);
  const filter = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
  const dir = p.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

  const [rows, count] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT s.id, s.name, st.code AS type, s.is_active, c.name AS city, stt.name AS state, s.created_at,
             a.full_name AS admin_name, a.phone AS admin_phone, ac.dial_code AS admin_dial,
             ${UNIT_COUNT} AS unit_count
      ${FROM}
      ${filter}
      ORDER BY ${ORDER_BY[p.sort]} ${dir}, s.id DESC
      LIMIT ${p.pageSize} OFFSET ${(p.page - 1) * p.pageSize}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${FROM} ${filter}`,
  ]);

  return { items: rows.map(toDto), total: Number(count[0]?.total ?? 0), page: p.page, pageSize: p.pageSize };
};

export const getDashboard = async (): Promise<DashboardDto> => {
  const [totals, units, recent] = await Promise.all([
    prisma.$queryRaw<{ total: bigint; active: bigint }[]>`SELECT count(*) AS total, count(*) FILTER (WHERE is_active) AS active FROM society`,
    prisma.$queryRaw<{ units: bigint }[]>`
      SELECT count(*) AS units FROM structure x JOIN structure_type xt ON xt.id = x.structure_type_id
      WHERE x.is_active AND xt.is_unit`,
    listSocieties({ sort: 'createdAt', order: 'desc', page: 1, pageSize: 4 }),
  ]);
  const total = Number(totals[0]?.total ?? 0);
  const active = Number(totals[0]?.active ?? 0);
  return {
    totalSocieties: total,
    activeSocieties: active,
    inactiveSocieties: total - active,
    unitsManaged: Number(units[0]?.units ?? 0),
    recentSocieties: recent.items,
  };
};

// ---------------------------------------------------------------- one society

// Everything the overview shows. The first admin is the longest-serving current President (same rule as the list).
export const getSocietyDetail = async (societyId: bigint): Promise<SocietyDetailDto> => {
  const s = await prisma.society.findUnique({
    where: { id: societyId },
    select: {
      id: true, name: true, is_active: true, registration_number: true, phone: true, email: true, address: true, pincode: true,
      latitude: true, longitude: true, created_at: true,
      society_type: { select: { code: true } },
      city: { select: { id: true, name: true, state: { select: { id: true, name: true } }, country: { select: { name: true } } } },
      upload: { select: { storage_key: true, file_name: true } },
    },
  });
  if (!s) throw new ApiError(404, 'NOT_FOUND', 'Society not found');

  const [counts, admins, reason] = await Promise.all([
    prisma.$queryRaw<{ buildings: bigint; units: bigint; occupied: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE t.is_building) AS buildings,
        count(*) FILTER (WHERE t.is_unit) AS units,
        count(*) FILTER (WHERE t.is_unit AND EXISTS (
          SELECT 1 FROM user_resident_map m WHERE m.unit_id = x.id AND m.move_out_date IS NULL AND m.is_active)) AS occupied
      FROM structure x JOIN structure_type t ON t.id = x.structure_type_id
      WHERE x.society_id = ${societyId} AND x.is_active`,
    listAdmins(societyId),
    s.is_active
      ? null
      : prisma.society_activity.findFirst({
          where: { society_id: societyId, society_activity_type: { code: 'DEACTIVATED' } },
          orderBy: { id: 'desc' },
          select: { note: true },
        }),
  ]);
  const admin = admins[0];
  const lat = s.latitude === null ? null : Number(s.latitude);
  const lng = s.longitude === null ? null : Number(s.longitude);

  return {
    id: s.id.toString(),
    name: s.name,
    type: s.society_type.code as SocietyType,
    status: s.is_active ? 'ACTIVE' : 'INACTIVE',
    registrationNumber: s.registration_number,
    phone: s.phone,
    email: s.email,
    logoUrl: s.upload
      ? await storage.downloadUrl(s.upload.storage_key, { expiresInSeconds: env.storage.downloadUrlTtlSeconds, fileName: s.upload.file_name })
      : null,
    address: s.address ?? '',
    city: { id: s.city.id.toString(), name: s.city.name },
    state: { id: s.city.state.id.toString(), name: s.city.state.name },
    country: s.city.country.name,
    pincode: s.pincode ?? '',
    latitude: lat,
    longitude: lng,
    mapUrl: lat !== null && lng !== null ? `https://www.google.com/maps?q=${lat},${lng}` : null,
    buildingCount: Number(counts[0]?.buildings ?? 0),
    unitCount: Number(counts[0]?.units ?? 0),
    occupiedUnitCount: Number(counts[0]?.occupied ?? 0),
    ...(admin && { firstAdmin: admin }),
    inactiveReason: reason?.note ?? null,
    createdAt: s.created_at.toISOString(),
  };
};
