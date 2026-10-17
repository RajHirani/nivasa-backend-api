import { Prisma } from '@prisma/client';
import { buildingDto, flatDto, unitInclude } from '../../lib/dto.js';
import { idOf, lookups } from '../../lib/lookups.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { decodeCursor, encodeCursor } from '../../utils/cursor.js';
import { toUploadDto } from '../uploads/uploads.service.js';
import type { HomeRequestCountsDto, HomeRequestDto } from './home-requests.types.js';

const requestInclude = {
  request_status: { select: { code: true } },
  resident_role: { select: { code: true } },
  resident_relation: { select: { code: true, name: true } },
  occupancy_status: { select: { code: true } },
  app_user_home_request_user_idToapp_user: {
    select: { id: true, full_name: true, phone: true, email: true, country: { select: { dial_code: true } } },
  },
  app_user_home_request_reviewed_byToapp_user: { select: { id: true, full_name: true } },
  structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
  home_request_document: {
    orderBy: { created_at: 'asc' },
    include: { upload: { include: { upload_purpose: { select: { code: true, name: true } } } } },
  },
} satisfies Prisma.home_requestInclude;

type RequestRow = Prisma.home_requestGetPayload<{ include: typeof requestInclude }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const toDto = async (r: RequestRow): Promise<HomeRequestDto> => {
  const applicant = r.app_user_home_request_user_idToapp_user;
  const reviewer = r.app_user_home_request_reviewed_byToapp_user;
  const dated = r.home_request_document.map((d) => d.upload).find((u) => u.agreement_start || u.agreement_end);
  return {
    requestId: r.id.toString(),
    status: r.request_status.code,
    rejectionReason: r.rejection_reason,
    applicant: {
      id: applicant.id.toString(),
      name: applicant.full_name,
      countryCode: applicant.country.dial_code,
      mobile: applicant.phone.slice(applicant.country.dial_code.length),
      email: applicant.email,
    },
    role: r.resident_role.code,
    relation: r.resident_relation.code,
    relationLabel: r.resident_relation.name,
    occupancy: r.occupancy_status.code,
    building: buildingDto(r.structure),
    flat: flatDto(r.structure),
    agreementStart: day(dated?.agreement_start ?? null),
    agreementEnd: day(dated?.agreement_end ?? null),
    documents: await Promise.all(
      r.home_request_document.map(async (d) => ({
        ...(await toUploadDto(d.upload)),
        purposeLabel: d.upload.upload_purpose.name,
        uploadedAt: d.upload.created_at.toISOString(),
      })),
    ),
    createdAt: r.created_at.toISOString(),
    decidedAt: r.reviewed_at?.toISOString() ?? null,
    reviewedBy: reviewer ? { id: reviewer.id.toString(), name: reviewer.full_name } : null,
  };
};

// Only requests of the active society are visible; anything else is simply "not found".
const loadRequest = async (societyId: bigint, requestId: bigint): Promise<RequestRow> => {
  const row = await prisma.home_request.findFirst({
    where: { id: requestId, society_id: societyId, request_status: { code: { not: 'CANCELLED' } } },
    include: requestInclude,
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Home request not found');
  return row;
};

export const getRequest = async (societyId: bigint, requestId: bigint): Promise<HomeRequestDto> =>
  toDto(await loadRequest(societyId, requestId));

// Oldest first, so the queue is worked in the order people applied.
export const listRequests = async (societyId: bigint, status: string, limit: number, cursor?: string) => {
  const after = decodeCursor<{ t: string; i: string }>(cursor);
  if (cursor && !after) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'cursor', message: 'Invalid cursor' }]);
  const afterAt = after ? new Date(after.t) : null;

  const rows = await prisma.home_request.findMany({
    where: {
      society_id: societyId,
      request_status: { code: status },
      ...(after && afterAt
        ? { OR: [{ created_at: { gt: afterAt } }, { created_at: afterAt, id: { gt: BigInt(after.i) } }] }
        : {}),
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    include: requestInclude,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await Promise.all(page.map(toDto)),
    nextCursor: rows.length > limit && last ? encodeCursor({ t: last.created_at.toISOString(), i: last.id.toString() }) : null,
  };
};

// LIKE wildcards in what a person typed are plain characters.
const likeSafe = (s: string) => s.replace(/[\\%_]/g, '\\$&');

interface PageFilters {
  status: string;
  page: number;
  pageSize: number;
  q?: string | undefined;
  buildingId?: string | undefined;
  role?: string | undefined;
}

// The portal's table: newest first, filtered by status, block, Owner/Tenant and a search over the applicant's name,
// the flat and the phone number. Cancelled requests are never listed.
export const listRequestsPage = async (societyId: bigint, f: PageFilters) => {
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, '');
  const where: Prisma.home_requestWhereInput = {
    society_id: societyId,
    request_status: { code: f.status === 'ALL' ? { not: 'CANCELLED' } : f.status },
    ...(f.role && { resident_role: { code: f.role } }),
    ...(f.buildingId && { structure: { building_id: BigInt(f.buildingId) } }),
    ...(q && {
      OR: [
        { app_user_home_request_user_idToapp_user: { full_name: { contains: likeSafe(q), mode: 'insensitive' } } },
        { structure: { identifier: { contains: likeSafe(q), mode: 'insensitive' } } },
        ...(digits ? [{ app_user_home_request_user_idToapp_user: { phone: { contains: digits } } }] : []),
      ],
    }),
  };
  const [total, rows] = await Promise.all([
    prisma.home_request.count({ where }),
    prisma.home_request.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: f.page * f.pageSize,
      take: f.pageSize,
      include: requestInclude,
    }),
  ]);
  return { items: await Promise.all(rows.map(toDto)), total, nextCursor: null };
};

// Tab numbers of the portal: one per status and the sum (cancelled requests are not counted).
export const requestCounts = async (societyId: bigint): Promise<HomeRequestCountsDto> => {
  const rows = await prisma.home_request.groupBy({ by: ['request_status_id'], where: { society_id: societyId }, _count: { _all: true } });
  const ids = (await lookups()).requestStatus;
  const of = (code: string) => rows.find((r) => r.request_status_id === ids.get(code))?._count._all ?? 0;
  const counts = { PENDING: of('PENDING'), APPROVED: of('APPROVED'), REJECTED: of('REJECTED') };
  return { ...counts, ALL: counts.PENDING + counts.APPROVED + counts.REJECTED };
};

const notPending = () => new ApiError(409, 'REQUEST_NOT_PENDING', 'This request has already been reviewed');

// One transaction: the request is decided, the resident record is created and the person becomes a member of the society.
export const approveRequest = async (societyId: bigint, reviewerId: bigint, requestId: bigint): Promise<HomeRequestDto> => {
  try {
    await prisma.$transaction(async (tx) => {
      const request = await tx.home_request.findFirst({
        where: { id: requestId, society_id: societyId },
        select: {
          user_id: true,
          unit_id: true,
          resident_role_id: true,
          resident_relation_id: true,
          occupancy_status_id: true,
          request_status: { select: { code: true } },
        },
      });
      if (!request || request.request_status.code === 'CANCELLED') throw new ApiError(404, 'NOT_FOUND', 'Home request not found');
      if (request.request_status.code !== 'PENDING') throw notPending();

      const ids = await lookups();
      const approvedId = idOf(ids.requestStatus, 'APPROVED');
      const activeStatusId = idOf(ids.memberStatus, 'ACTIVE');

      // The status guard makes two reviewers (or a cancel at the same moment) decide the request only once.
      const now = new Date();
      const decided = await tx.home_request.updateMany({
        where: { id: requestId, request_status: { code: 'PENDING' } },
        data: { request_status_id: approvedId, reviewed_by: reviewerId, reviewed_at: now, rejection_reason: null, updated_at: now },
      });
      if (decided.count === 0) throw notPending();

      const current = await tx.user_resident_map.findFirst({
        where: { user_id: request.user_id, unit_id: request.unit_id, move_out_date: null },
        select: { id: true },
      });
      if (current) throw new ApiError(409, 'HOME_ALREADY_REQUESTED', 'This person already lives in this flat');

      // A blocked member keeps the block: the home is recorded but stays inactive until the society reactivates them.
      const membership = await tx.user_society_map.findFirst({
        where: { user_id: request.user_id, society_id: societyId, left_at: null },
        select: { member_status: { select: { code: true } } },
      });
      if (!membership) {
        await tx.user_society_map.create({
          data: { user_id: request.user_id, society_id: societyId, member_status_id: activeStatusId, added_by: reviewerId },
        });
      }
      await tx.user_resident_map.create({
        data: {
          user_id: request.user_id,
          unit_id: request.unit_id,
          society_id: societyId,
          resident_role_id: request.resident_role_id,
          resident_relation_id: request.resident_relation_id,
          occupancy_status_id: request.occupancy_status_id,
          home_request_id: requestId,
          is_active: !membership || membership.member_status.code === 'ACTIVE',
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError(409, 'HOME_ALREADY_REQUESTED', 'This person already lives in this flat');
    }
    throw e;
  }
  return getRequest(societyId, requestId);
};

export const rejectRequest = async (
  societyId: bigint,
  reviewerId: bigint,
  requestId: bigint,
  reason: string,
): Promise<HomeRequestDto> => {
  const current = await loadRequest(societyId, requestId);
  if (current.request_status.code !== 'PENDING') throw notPending();

  const rejectedId = idOf((await lookups()).requestStatus, 'REJECTED');
  const now = new Date();
  const decided = await prisma.home_request.updateMany({
    where: { id: requestId, society_id: societyId, request_status: { code: 'PENDING' } },
    data: { request_status_id: rejectedId, rejection_reason: reason, reviewed_by: reviewerId, reviewed_at: now, updated_at: now },
  });
  if (decided.count === 0) throw notPending();
  return getRequest(societyId, requestId);
};
