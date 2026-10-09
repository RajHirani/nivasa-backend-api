import { cityDto, countryDto, flatDto, societyDto, unitInclude } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { decodeCursor, encodeCursor } from '../../utils/cursor.js';

const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);

export const listCountries = async (q?: string) =>
  (await prisma.country.findMany({
    where: { is_active: true, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) },
    orderBy: { name: 'asc' },
  })).map(countryDto);

// popular=true → the grid of popular cities in their display order; otherwise every city A–Z.
export const listCities = async (countryId: bigint, popular: boolean, q?: string) =>
  (await prisma.city.findMany({
    where: {
      country_id: countryId,
      is_active: true,
      ...(popular ? { is_popular: true } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: popular ? [{ popular_rank: 'asc' }, { name: 'asc' }] : { name: 'asc' },
  })).map(cityDto);

// Alphabetical, keyset-paged by (name, id).
export const searchSocieties = async (cityId: bigint, q: string | undefined, limit: number, cursor?: string) => {
  const after = decodeCursor<{ n: string; i: string }>(cursor);
  if (cursor && !after) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'cursor', message: 'Invalid cursor' }]);

  const rows = await prisma.society.findMany({
    where: {
      city_id: cityId,
      is_active: true,
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      ...(after
        ? { OR: [{ name: { gt: after.n } }, { name: after.n, id: { gt: BigInt(after.i) } }] }
        : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(societyDto),
    nextCursor: rows.length > limit && last ? encodeCursor({ n: last.name, i: last.id.toString() }) : null,
  };
};

export const listBuildings = async (societyId: bigint) => {
  const society = await prisma.society.findFirst({ where: { id: societyId, is_active: true }, select: { id: true } });
  if (!society) throw notFound('Society');
  const rows = await prisma.structure.findMany({
    where: { society_id: societyId, is_active: true, structure_type: { is_building: true } },
    orderBy: [{ sort_order: 'asc' }, { identifier: 'asc' }],
    select: { id: true, identifier: true },
  });
  return rows.map((b) => ({ id: b.id.toString(), name: b.identifier }));
};

export const listFlats = async (buildingId: bigint, q?: string) => {
  const building = await prisma.structure.findFirst({
    where: { id: buildingId, is_active: true, structure_type: { is_building: true }, society: { is_active: true } },
    select: { id: true },
  });
  if (!building) throw notFound('Building');
  const rows = await prisma.structure.findMany({
    where: {
      building_id: buildingId,
      is_active: true,
      structure_type: { is_unit: true },
      ...(q ? { identifier: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ structure_structure_floor_idTostructure: { floor_number: 'asc' } }, { sort_order: 'asc' }, { identifier: 'asc' }],
    select: { id: true, identifier: true, floor_number: true, ...unitInclude },
  });
  return rows.map(flatDto);
};
