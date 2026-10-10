import { Prisma } from '@prisma/client';
import { buildingDto, cityDto, countryDto, flatDto, societyDto, unitInclude } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import { idOf, lookups } from '../../lib/lookups.js';
import { ApiError } from '../../utils/api-error.js';
import { toUploadDto } from '../uploads/uploads.service.js';
import type { HomeRequestInput } from './homes.schema.js';
import type { HomeDto } from './homes.types.js';

const DOCUMENT_PURPOSE = { OWNER: 'SALES_DEED', TENANT: 'RENT_AGREEMENT' } as const;

const invalid = (field: string, message: string) =>
  new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field, message }]);

const requestInclude = {
  request_status: { select: { code: true } },
  resident_role: { select: { code: true } },
  resident_relation: { select: { code: true, name: true } },
  occupancy_status: { select: { code: true } },
  society: { include: { city: { include: { country: true } } } },
  structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
  home_request_document: {
    orderBy: { created_at: 'asc' },
    include: { upload: { include: { upload_purpose: { select: { code: true } } } } },
  },
  user_resident_map: {
    select: {
      id: true,
      move_out_date: true,
      resident_relation: { select: { code: true, name: true } },
      occupancy_status: { select: { code: true } },
    },
  },
} satisfies Prisma.home_requestInclude;

type RequestRow = Prisma.home_requestGetPayload<{ include: typeof requestInclude }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// An approved request becomes a resident record: its id is the home id and its relation/occupancy are the live ones.
// Returns null for an approved home the person has since moved out of.
const toHomeDto = async (r: RequestRow): Promise<HomeDto | null> => {
  const status = r.request_status.code;
  const resident = r.user_resident_map[0];
  if (status === 'APPROVED' && resident?.move_out_date) return null;

  const live = status === 'APPROVED' && resident ? resident : r;
  const dated = r.home_request_document.map((d) => d.upload).find((u) => u.agreement_start || u.agreement_end);
  return {
    id: (status === 'APPROVED' && resident ? resident.id : r.id).toString(),
    requestId: r.id.toString(),
    status,
    rejectionReason: status === 'REJECTED' ? r.rejection_reason : null,
    role: r.resident_role.code,
    relation: live.resident_relation.code,
    relationLabel: live.resident_relation.name,
    occupancy: live.occupancy_status.code,
    society: societyDto(r.society),
    city: cityDto(r.society.city),
    country: countryDto(r.society.city.country),
    building: buildingDto(r.structure),
    flat: flatDto(r.structure),
    agreementStart: day(dated?.agreement_start ?? null),
    agreementEnd: day(dated?.agreement_end ?? null),
    documents: await Promise.all(r.home_request_document.map((d) => toUploadDto(d.upload))),
    createdAt: r.created_at.toISOString(),
    decidedAt: r.reviewed_at?.toISOString() ?? null,
  };
};

const loadRequest = async (userId: bigint, requestId: bigint): Promise<RequestRow> => {
  const row = await prisma.home_request.findFirst({
    where: { id: requestId, user_id: userId, request_status: { code: { not: 'CANCELLED' } } },
    include: requestInclude,
  });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Home request not found');
  return row;
};

const homeOf = async (userId: bigint, requestId: bigint): Promise<HomeDto> => {
  const dto = await toHomeDto(await loadRequest(userId, requestId));
  if (!dto) throw new ApiError(404, 'NOT_FOUND', 'Home request not found');
  return dto;
};

// Every request of the user (cancelled ones are gone), oldest first; approved homes carry the resident id.
export const listHomes = async (userId: bigint): Promise<HomeDto[]> => {
  const rows = await prisma.home_request.findMany({
    where: { user_id: userId, request_status: { code: { not: 'CANCELLED' } } },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: requestInclude,
  });
  return (await Promise.all(rows.map(toHomeDto))).filter((h): h is HomeDto => h !== null);
};

export const getHome = (userId: bigint, requestId: bigint): Promise<HomeDto> => homeOf(userId, requestId);

// Validates the answers. The flat tells us the society, so the request carries no society or building id.
const prepare = async (userId: bigint, input: HomeRequestInput) => {
  const unit = await prisma.structure.findFirst({
    where: { id: BigInt(input.flatId), is_active: true, structure_type: { is_unit: true }, society: { is_active: true } },
    select: { id: true, society_id: true },
  });
  if (!unit) throw invalid('flatId', 'Flat not found');

  const alreadyLives = await prisma.user_resident_map.findFirst({
    where: { user_id: userId, unit_id: unit.id, move_out_date: null },
    select: { id: true },
  });
  if (alreadyLives) throw new ApiError(409, 'HOME_ALREADY_REQUESTED', 'You already have a request or home for this flat');

  // The documents must be the caller's own and of the right kind. A file already used by another request is
  // refused when it is attached (attachDocuments), not here.
  const documentIds = [...new Set(input.documentIds.map((d) => BigInt(d)))];
  const ownDocuments = await prisma.upload.count({
    where: { id: { in: documentIds }, user_id: userId, upload_purpose: { code: DOCUMENT_PURPOSE[input.role] } },
  });
  if (ownDocuments !== documentIds.length) {
    throw invalid('documentIds', input.role === 'OWNER' ? 'Upload your Sales Deed' : 'Upload your Rental Agreement');
  }

  const ids = await lookups();
  const isTenant = input.role === 'TENANT';
  return {
    unitId: unit.id,
    societyId: unit.society_id,
    documentIds,
    agreementStart: isTenant && input.agreementStart ? new Date(`${input.agreementStart}T00:00:00Z`) : null,
    agreementEnd: isTenant && input.agreementEnd ? new Date(`${input.agreementEnd}T00:00:00Z`) : null,
    roleId: idOf(ids.role, input.role),
    relationId: idOf(ids.relation, input.relation),
    occupancyId: idOf(ids.occupancy, input.occupancy),
    pendingId: idOf(ids.requestStatus, 'PENDING'),
  };
};

// Links the documents to the request and stores the agreement dates on them (the upload row is their only home).
// Every request needs freshly uploaded files; one that is already attached anywhere is refused.
const attachDocuments = async (
  tx: Prisma.TransactionClient,
  requestId: bigint,
  r: { documentIds: bigint[]; agreementStart: Date | null; agreementEnd: Date | null },
) => {
  const now = new Date();
  for (const uploadId of r.documentIds) {
    // The attached_at IS NULL guard makes a concurrent claim of the same file fail instead of double-attach.
    const claimed = await tx.upload.updateMany({
      where: { id: uploadId, attached_at: null },
      data: { attached_at: now, agreement_start: r.agreementStart, agreement_end: r.agreementEnd },
    });
    if (claimed.count === 0) throw new ApiError(409, 'UPLOAD_IN_USE', 'One of the documents is already used by another request');
    await tx.home_request_document.create({ data: { home_request_id: requestId, upload_id: uploadId } });
  }
};

const conflict = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ApiError(409, 'HOME_ALREADY_REQUESTED', 'You already have a request or home for this flat')
    : null;

export const createHome = async (userId: bigint, input: HomeRequestInput): Promise<HomeDto> => {
  const r = await prepare(userId, input);
  try {
    const requestId = await prisma.$transaction(async (tx) => {
      const created = await tx.home_request.create({
        data: {
          user_id: userId,
          society_id: r.societyId,
          unit_id: r.unitId,
          resident_role_id: r.roleId,
          resident_relation_id: r.relationId,
          occupancy_status_id: r.occupancyId,
          request_status_id: r.pendingId,
        },
        select: { id: true },
      });
      await attachDocuments(tx, created.id, r);
      return created.id;
    });
    return await homeOf(userId, requestId);
  } catch (e) {
    throw conflict(e) ?? e;
  }
};

// Pending or rejected requests are cancelled (kept as CANCELLED for history); an approved home cannot be.
export const cancelHome = async (userId: bigint, requestId: bigint): Promise<void> => {
  const current = await prisma.home_request.findFirst({
    where: { id: requestId, user_id: userId, request_status: { code: { not: 'CANCELLED' } } },
    select: { request_status: { select: { code: true } } },
  });
  if (!current) throw new ApiError(404, 'NOT_FOUND', 'Home request not found');
  if (current.request_status.code === 'APPROVED') {
    throw new ApiError(409, 'HOME_NOT_CANCELLABLE', 'An approved home cannot be cancelled');
  }
  const cancelledId = idOf((await lookups()).requestStatus, 'CANCELLED');
  // The status guard keeps this correct if the admin approves at the same moment.
  const done = await prisma.home_request.updateMany({
    where: { id: requestId, user_id: userId, request_status: { code: { in: ['PENDING', 'REJECTED'] } } },
    data: { request_status_id: cancelledId, updated_at: new Date() },
  });
  if (done.count === 0) throw new ApiError(409, 'HOME_NOT_CANCELLABLE', 'An approved home cannot be cancelled');
};
