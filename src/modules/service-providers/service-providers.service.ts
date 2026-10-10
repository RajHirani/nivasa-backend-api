import { Prisma } from '@prisma/client';
import { buildingDto, flatDto, unitInclude } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { decodeCursor, encodeCursor } from '../../utils/cursor.js';
import { isValidNationalNumber, toE164 } from '../../utils/phone.js';
import type { CreateProviderInput, ReviewInput, UpdateProviderInput } from './service-providers.schema.js';
import type {
  DailyHelpDto,
  ReviewDto,
  ServiceProviderDetailDto,
  ServiceProviderDto,
  ServiceTypeDto,
  UnitRefDto,
} from './service-providers.types.js';

// Who is asking, in which society, and what they may do there.
export interface Caller {
  userId: bigint;
  societyId: bigint;
  canManage: boolean; // DIRECTORY_MANAGE
}

const today = () => new Date(new Date().toISOString().slice(0, 10));

const invalid = (field: string, message: string) =>
  new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field, message }]);

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Service provider not found');

const providerInclude = {
  service_type: { select: { id: true, code: true, name: true, is_daily_help: true } },
} satisfies Prisma.service_providerInclude;
type ProviderRow = Prisma.service_providerGetPayload<{ include: typeof providerInclude }>;

const unitSelect = { id: true, identifier: true, floor_number: true, ...unitInclude } as const;

const toServiceType = (t: ProviderRow['service_type']): ServiceTypeDto => ({
  id: t.id.toString(),
  code: t.code,
  name: t.name,
  isDailyHelp: t.is_daily_help,
});

const phoneOf = (countryCode: string, mobile: string): string => {
  if (!isValidNationalNumber(countryCode, mobile)) throw invalid('mobile', 'Enter a valid mobile number');
  return toE164(countryCode, mobile);
};

// Ids of the units where the caller currently lives in this society.
export const currentUnitIds = async (userId: bigint, societyId: bigint): Promise<bigint[]> => {
  const rows = await prisma.user_resident_map.findMany({
    where: { user_id: userId, society_id: societyId, move_out_date: null, is_active: true },
    select: { unit_id: true },
  });
  return rows.map((r) => r.unit_id);
};

const requireHome = async (caller: Caller, unitId: bigint) => {
  if (!(await currentUnitIds(caller.userId, caller.societyId)).includes(unitId)) {
    throw new ApiError(403, 'HOME_NOT_APPROVED', 'This is not one of your approved homes in this society');
  }
};

// Rows → API shape: adds ratings (daily help) and whether the provider serves one of the caller's homes.
export const toProviderDtos = async (rows: ProviderRow[], caller: Caller): Promise<ServiceProviderDto[]> => {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [ratings, mine] = await Promise.all([
    prisma.service_provider_review.groupBy({
      by: ['service_provider_id'],
      where: { service_provider_id: { in: ids } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    currentUnitIds(caller.userId, caller.societyId).then((units) =>
      units.length === 0
        ? []
        : prisma.service_provider_household.findMany({
            where: { service_provider_id: { in: ids }, ended_on: null, unit_id: { in: units } },
            select: { service_provider_id: true },
          }),
    ),
  ]);
  const ratingOf = new Map(ratings.map((r) => [r.service_provider_id, r]));
  const serving = new Set(mine.map((m) => m.service_provider_id));

  return rows.map((r) => {
    const rt = ratingOf.get(r.id);
    return {
      id: r.id.toString(),
      name: r.name,
      phone: r.phone,
      label: r.service_type.name,
      serviceType: toServiceType(r.service_type),
      rating: r.service_type.is_daily_help
        ? { average: rt?._avg.rating ? Math.round(rt._avg.rating * 10) / 10 : 0, count: rt?._count._all ?? 0 }
        : null,
      canEdit: caller.canManage || r.created_by === caller.userId,
      servesMyHome: serving.has(r.id),
    };
  });
};

const loadProvider = async (caller: Caller, providerId: bigint): Promise<ProviderRow> => {
  const row = await prisma.service_provider.findFirst({
    where: { id: providerId, society_id: caller.societyId, is_active: true },
    include: providerInclude,
  });
  if (!row) throw notFound();
  return row;
};

const loadDailyHelpProvider = async (caller: Caller, providerId: bigint): Promise<ProviderRow> => {
  const row = await loadProvider(caller, providerId);
  if (!row.service_type.is_daily_help) {
    throw new ApiError(409, 'NOT_DAILY_HELP', 'Only daily-help services can be linked to a home or reviewed');
  }
  return row;
};

// The Service Directory: every active provider of the society.
export const listProviders = async (caller: Caller): Promise<ServiceProviderDto[]> => {
  const rows = await prisma.service_provider.findMany({
    where: { society_id: caller.societyId, is_active: true },
    orderBy: [{ service_type: { sort_order: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    include: providerInclude,
  });
  return toProviderDtos(rows, caller);
};

// Built-in types plus the ones this society added.
export const listServiceTypes = async (caller: Caller): Promise<ServiceTypeDto[]> => {
  const rows = await prisma.service_type.findMany({
    where: { is_active: true, OR: [{ society_id: null }, { society_id: caller.societyId }] },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
  });
  return rows.map((t) => ({ id: t.id.toString(), code: t.code, name: t.name, isDailyHelp: t.is_daily_help }));
};

const unitRef = (u: Parameters<typeof flatDto>[0]): UnitRefDto => ({ building: buildingDto(u), flat: flatDto(u) });

const households = async (providerId: bigint): Promise<UnitRefDto[]> => {
  const rows = await prisma.service_provider_household.findMany({
    where: { service_provider_id: providerId, ended_on: null },
    include: { structure: { select: unitSelect } },
  });
  return rows.map((r) => unitRef(r.structure)).sort((a, b) => a.flat.code.localeCompare(b.flat.code, undefined, { numeric: true }));
};

const reviewInclude = {
  app_user: { select: { id: true, full_name: true } },
  structure: { select: unitSelect },
} satisfies Prisma.service_provider_reviewInclude;
type ReviewRow = Prisma.service_provider_reviewGetPayload<{ include: typeof reviewInclude }>;

const reviewDto = (r: ReviewRow, userId: bigint): ReviewDto => ({
  id: r.id.toString(),
  rating: r.rating,
  comment: r.comment,
  reviewer: { id: r.app_user.id.toString(), name: r.app_user.full_name },
  flat: flatDto(r.structure),
  isMine: r.user_id === userId,
  updatedAt: r.updated_at.toISOString(),
});

export const getProvider = async (caller: Caller, providerId: bigint): Promise<ServiceProviderDetailDto> => {
  const row = await loadProvider(caller, providerId);
  const [[dto], served, mine] = await Promise.all([
    toProviderDtos([row], caller),
    row.service_type.is_daily_help ? households(row.id) : Promise.resolve([]),
    row.service_type.is_daily_help
      ? prisma.service_provider_review.findUnique({
          where: { service_provider_id_user_id: { service_provider_id: row.id, user_id: caller.userId } },
          include: reviewInclude,
        })
      : Promise.resolve(null),
  ]);
  return { ...dto!, households: served, myReview: mine ? reviewDto(mine, caller.userId) : null };
};

const link = async (caller: Caller, providerId: bigint, unitId: bigint) => {
  await requireHome(caller, unitId);
  const current = await prisma.service_provider_household.findFirst({
    where: { service_provider_id: providerId, unit_id: unitId, ended_on: null },
    select: { id: true },
  });
  if (current) return;
  try {
    await prisma.service_provider_household.create({
      data: { service_provider_id: providerId, unit_id: unitId, added_by: caller.userId },
    });
  } catch (e) {
    // a concurrent link of the same pair is fine: the end state is the same
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
};

// Any resident may add a provider. Adding a phone that is already listed for that service links to the existing entry.
export const createProvider = async (
  caller: Caller,
  input: CreateProviderInput,
): Promise<{ provider: ServiceProviderDetailDto; created: boolean }> => {
  const type = await prisma.service_type.findFirst({
    where: { id: Number(input.serviceTypeId), is_active: true, OR: [{ society_id: null }, { society_id: caller.societyId }] },
    select: { id: true, is_daily_help: true },
  });
  if (!type) throw invalid('serviceTypeId', 'Choose a service');
  const phone = phoneOf(input.countryCode, input.mobile);

  const unitId = input.unitId ? BigInt(input.unitId) : null;
  if (unitId) {
    if (!type.is_daily_help) throw new ApiError(409, 'NOT_DAILY_HELP', 'Only daily-help services can be linked to a home');
    await requireHome(caller, unitId);
  }

  const find = () =>
    prisma.service_provider.findFirst({
      where: { society_id: caller.societyId, phone, service_type_id: type.id, is_active: true },
      select: { id: true },
    });
  let existing = await find();
  let created = false;
  if (!existing) {
    try {
      existing = await prisma.service_provider.create({
        data: { society_id: caller.societyId, service_type_id: type.id, name: input.name, phone, created_by: caller.userId },
        select: { id: true },
      });
      created = true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      existing = await find(); // someone added the same person at the same moment
      if (!existing) throw e;
    }
  }
  if (unitId) await link(caller, existing.id, unitId);
  return { provider: await getProvider(caller, existing.id), created };
};

// Only the creator or someone with DIRECTORY_MANAGE may change or remove an entry.
const loadEditable = async (caller: Caller, providerId: bigint): Promise<ProviderRow> => {
  const row = await loadProvider(caller, providerId);
  if (!caller.canManage && row.created_by !== caller.userId) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the person who added this entry or the committee can change it');
  }
  return row;
};

export const updateProvider = async (caller: Caller, providerId: bigint, input: UpdateProviderInput): Promise<ServiceProviderDetailDto> => {
  const row = await loadEditable(caller, providerId);
  const data: Prisma.service_providerUncheckedUpdateInput = { updated_at: new Date() };

  if (input.name !== undefined) data.name = input.name;
  if (input.mobile !== undefined && input.countryCode !== undefined) data.phone = phoneOf(input.countryCode, input.mobile);
  if (input.serviceTypeId !== undefined) {
    const type = await prisma.service_type.findFirst({
      where: { id: Number(input.serviceTypeId), is_active: true, OR: [{ society_id: null }, { society_id: caller.societyId }] },
      select: { id: true, is_daily_help: true },
    });
    if (!type) throw invalid('serviceTypeId', 'Choose a service');
    // links and reviews only make sense for daily-help types, so the kind cannot change
    if (type.is_daily_help !== row.service_type.is_daily_help) {
      throw invalid('serviceTypeId', 'Choose a service of the same kind (daily help or on call)');
    }
    data.service_type_id = type.id;
  }

  try {
    await prisma.service_provider.update({ where: { id: row.id }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError(409, 'DUPLICATE_PROVIDER', 'This person is already listed for this service');
    }
    throw e;
  }
  return getProvider(caller, row.id);
};

// Soft removal: the entry disappears from the directory and its home links end; reviews are kept.
export const removeProvider = async (caller: Caller, providerId: bigint): Promise<void> => {
  const row = await loadEditable(caller, providerId);
  await prisma.$transaction([
    prisma.service_provider.update({ where: { id: row.id }, data: { is_active: false, updated_at: new Date() } }),
    prisma.service_provider_household.updateMany({
      where: { service_provider_id: row.id, ended_on: null },
      data: { ended_on: today(), updated_at: new Date() },
    }),
  ]);
};

// Daily help: only the residents of a unit link or unlink it (the committee does not edit links).
export const linkHome = async (caller: Caller, providerId: bigint, unitId: bigint): Promise<ServiceProviderDetailDto> => {
  const row = await loadDailyHelpProvider(caller, providerId);
  await link(caller, row.id, unitId);
  return getProvider(caller, row.id);
};

export const unlinkHome = async (caller: Caller, providerId: bigint, unitId: bigint): Promise<void> => {
  const row = await loadProvider(caller, providerId);
  await requireHome(caller, unitId);
  const ended = await prisma.service_provider_household.updateMany({
    where: { service_provider_id: row.id, unit_id: unitId, ended_on: null },
    data: { ended_on: today(), updated_at: new Date() },
  });
  if (ended.count === 0) throw new ApiError(404, 'NOT_FOUND', 'This provider is not linked to your home');
};

// "Daily Help": providers that currently serve one of the caller's homes, with those homes.
export const listDailyHelp = async (caller: Caller): Promise<DailyHelpDto[]> => {
  const units = await currentUnitIds(caller.userId, caller.societyId);
  if (units.length === 0) return [];

  const links = await prisma.service_provider_household.findMany({
    where: {
      ended_on: null,
      unit_id: { in: units },
      service_provider: { society_id: caller.societyId, is_active: true, service_type: { is_daily_help: true } },
    },
    include: { service_provider: { include: providerInclude }, structure: { select: unitSelect } },
  });

  const byProvider = new Map<bigint, { row: ProviderRow; units: UnitRefDto[] }>();
  for (const l of links) {
    const entry = byProvider.get(l.service_provider_id) ?? { row: l.service_provider, units: [] };
    entry.units.push(unitRef(l.structure));
    byProvider.set(l.service_provider_id, entry);
  }
  const entries = [...byProvider.values()].sort(
    (a, b) => a.row.service_type.name.localeCompare(b.row.service_type.name) || a.row.name.localeCompare(b.row.name),
  );
  const dtos = await toProviderDtos(entries.map((e) => e.row), caller);
  return dtos.map((d, i) => ({ ...d, myUnits: entries[i]!.units }));
};

// Reviews: only residents of a unit the provider currently serves, one editable review per person.
export const saveReview = async (caller: Caller, providerId: bigint, input: ReviewInput): Promise<ReviewDto> => {
  const row = await loadDailyHelpProvider(caller, providerId);
  const mine = await currentUnitIds(caller.userId, caller.societyId);
  const served = mine.length
    ? await prisma.service_provider_household.findMany({
        where: { service_provider_id: row.id, ended_on: null, unit_id: { in: mine } },
        select: { unit_id: true },
      })
    : [];
  const unitId = served[0]?.unit_id;
  if (!unitId) throw new ApiError(403, 'FORBIDDEN', 'Only residents of a home this provider serves can review');

  const comment = input.comment?.length ? input.comment : null;
  const saved = await prisma.service_provider_review.upsert({
    where: { service_provider_id_user_id: { service_provider_id: row.id, user_id: caller.userId } },
    create: { service_provider_id: row.id, user_id: caller.userId, unit_id: unitId, rating: input.rating, comment },
    update: { unit_id: unitId, rating: input.rating, comment, updated_at: new Date() },
    include: reviewInclude,
  });
  return reviewDto(saved, caller.userId);
};

export const deleteReview = async (caller: Caller, providerId: bigint): Promise<void> => {
  const row = await loadProvider(caller, providerId);
  const done = await prisma.service_provider_review.deleteMany({
    where: { service_provider_id: row.id, user_id: caller.userId },
  });
  if (done.count === 0) throw new ApiError(404, 'NOT_FOUND', 'You have not reviewed this provider');
};

// Newest first, keyset paged.
export const listReviews = async (caller: Caller, providerId: bigint, limit: number, cursor?: string) => {
  const row = await loadProvider(caller, providerId);
  const after = decodeCursor<{ t: string; i: string }>(cursor);
  if (cursor && !after) throw invalid('cursor', 'Invalid cursor');
  const afterAt = after ? new Date(after.t) : null;

  const rows = await prisma.service_provider_review.findMany({
    where: {
      service_provider_id: row.id,
      ...(after && afterAt
        ? { OR: [{ updated_at: { lt: afterAt } }, { updated_at: afterAt, id: { lt: BigInt(after.i) } }] }
        : {}),
    },
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: reviewInclude,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => reviewDto(r, caller.userId)),
    nextCursor: rows.length > limit && last ? encodeCursor({ t: last.updated_at.toISOString(), i: last.id.toString() }) : null,
  };
};
