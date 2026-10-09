import { Prisma } from '@prisma/client';
import { buildingDto, cityDto, countryDto, flatDto, lower, societyDto, unitInclude } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { toUploadDto } from '../uploads/uploads.service.js';
import type { HomeRequestInput } from './homes.schema.js';
import type { HomeDto } from './homes.types.js';

const RELATIONS_BY_ROLE = {
  owner: ['flat_owner', 'co_owner', 'owner_family'],
  tenant: ['tenant', 'tenant_family', 'flatmate'],
} as const;
const DOCUMENT_PURPOSE = { owner: 'SALES_DEED', tenant: 'RENT_AGREEMENT' } as const;

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
  const status = lower(r.request_status.code) as HomeDto['status'];
  const resident = r.user_resident_map[0];
  if (status === 'approved' && resident?.move_out_date) return null;

  const live = status === 'approved' && resident ? resident : r;
  const dated = r.home_request_document.map((d) => d.upload).find((u) => u.agreement_start || u.agreement_end);
  return {
    id: (status === 'approved' && resident ? resident.id : r.id).toString(),
    requestId: r.id.toString(),
    status,
    rejectionReason: status === 'rejected' ? r.rejection_reason : null,
    role: lower(r.resident_role.code),
    relation: lower(live.resident_relation.code),
    relationLabel: live.resident_relation.name,
    occupancy: lower(live.occupancy_status.code),
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

// Everything create and resubmit share: validates the answers and resolves them to database ids.
const resolveInput = async (tx: Prisma.TransactionClient, userId: bigint, input: HomeRequestInput, ownRequestId?: bigint) => {
  if (!(RELATIONS_BY_ROLE[input.role] as readonly string[]).includes(input.relation)) {
    throw invalid('relation', 'This relation does not match owner / tenant');
  }

  // Agreement dates belong to tenants only.
  let agreementStart: Date | null = null;
  let agreementEnd: Date | null = null;
  if (input.role === 'tenant') {
    if (!input.agreementStart) throw invalid('agreementStart', 'Enter the agreement start date');
    if (!input.agreementEnd) throw invalid('agreementEnd', 'Enter the agreement end date');
    const today = new Date().toISOString().slice(0, 10);
    if (input.agreementEnd <= input.agreementStart) throw invalid('agreementEnd', 'End date must be after the start date');
    if (input.agreementEnd < today) throw invalid('agreementEnd', 'End date cannot be in the past');
    agreementStart = new Date(`${input.agreementStart}T00:00:00Z`);
    agreementEnd = new Date(`${input.agreementEnd}T00:00:00Z`);
  } else if (input.agreementStart || input.agreementEnd) {
    throw invalid('agreementStart', 'Agreement dates are only for tenants');
  }

  const societyId = BigInt(input.societyId);
  const unit = await tx.structure.findFirst({
    where: {
      id: BigInt(input.flatId),
      society_id: societyId,
      building_id: BigInt(input.buildingId),
      is_active: true,
      structure_type: { is_unit: true },
      society: { is_active: true },
    },
    select: { id: true },
  });
  if (!unit) throw invalid('flatId', 'This flat was not found in the selected society and building');

  // A society that has blocked the person does not take new requests from them.
  const blocked = await tx.user_society_map.findFirst({
    where: { user_id: userId, society_id: societyId, left_at: null, member_status: { code: 'INACTIVE' } },
    select: { id: true },
  });
  if (blocked) throw new ApiError(403, 'MEMBERSHIP_INACTIVE', 'This society has blocked your access');

  const [open, current] = await Promise.all([
    tx.home_request.findFirst({
      where: { user_id: userId, unit_id: unit.id, request_status: { code: 'PENDING' }, ...(ownRequestId ? { id: { not: ownRequestId } } : {}) },
      select: { id: true },
    }),
    tx.user_resident_map.findFirst({ where: { user_id: userId, unit_id: unit.id, move_out_date: null }, select: { id: true } }),
  ]);
  if (open || current) throw new ApiError(409, 'HOME_ALREADY_REQUESTED', 'You already have a request or home for this flat');

  const documentIds = [...new Set(input.documentIds.map((d) => BigInt(d)))];
  const uploads = await tx.upload.findMany({
    where: { id: { in: documentIds }, user_id: userId },
    select: {
      id: true,
      attached_at: true,
      upload_purpose: { select: { code: true } },
      home_request_document: { select: { home_request_id: true } },
    },
  });
  if (uploads.length !== documentIds.length) throw invalid('documentIds', 'One of the documents was not found');
  for (const u of uploads) {
    if (u.upload_purpose.code !== DOCUMENT_PURPOSE[input.role]) {
      throw invalid('documentIds', input.role === 'owner' ? 'Upload your Sales Deed' : 'Upload your Rental Agreement');
    }
    const elsewhere = u.home_request_document.some((l) => l.home_request_id !== ownRequestId);
    if (elsewhere || (u.attached_at && !u.home_request_document.some((l) => l.home_request_id === ownRequestId))) {
      throw new ApiError(409, 'UPLOAD_IN_USE', 'One of the documents is already used by another request');
    }
  }

  const [role, relation, occupancy] = await Promise.all([
    tx.resident_role.findUniqueOrThrow({ where: { code: input.role.toUpperCase() }, select: { id: true } }),
    tx.resident_relation.findUniqueOrThrow({ where: { code: input.relation.toUpperCase() }, select: { id: true } }),
    tx.occupancy_status.findUniqueOrThrow({ where: { code: input.occupancy.toUpperCase() }, select: { id: true } }),
  ]);
  return { unitId: unit.id, societyId, documentIds, agreementStart, agreementEnd, role, relation, occupancy };
};

// Links the documents to the request and stores the agreement dates on them (the upload row is their only home).
const attachDocuments = async (
  tx: Prisma.TransactionClient,
  requestId: bigint,
  r: { documentIds: bigint[]; agreementStart: Date | null; agreementEnd: Date | null },
) => {
  const now = new Date();
  for (const uploadId of r.documentIds) {
    // The attached_at IS NULL / already-linked guard makes a concurrent claim of the same file fail instead of double-attach.
    const claimed = await tx.upload.updateMany({
      where: { id: uploadId, OR: [{ attached_at: null }, { home_request_document: { some: { home_request_id: requestId } } }] },
      data: { attached_at: now, agreement_start: r.agreementStart, agreement_end: r.agreementEnd },
    });
    if (claimed.count === 0) throw new ApiError(409, 'UPLOAD_IN_USE', 'One of the documents is already used by another request');
    await tx.home_request_document.upsert({
      where: { home_request_id_upload_id: { home_request_id: requestId, upload_id: uploadId } },
      create: { home_request_id: requestId, upload_id: uploadId },
      update: {},
    });
  }
};

const conflict = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    ? new ApiError(409, 'HOME_ALREADY_REQUESTED', 'You already have a request or home for this flat')
    : null;

export const createHome = async (userId: bigint, input: HomeRequestInput): Promise<HomeDto> => {
  try {
    const requestId = await prisma.$transaction(async (tx) => {
      const r = await resolveInput(tx, userId, input);
      const pending = await tx.request_status.findUniqueOrThrow({ where: { code: 'PENDING' }, select: { id: true } });
      const created = await tx.home_request.create({
        data: {
          user_id: userId,
          society_id: r.societyId,
          unit_id: r.unitId,
          resident_role_id: r.role.id,
          resident_relation_id: r.relation.id,
          occupancy_status_id: r.occupancy.id,
          request_status_id: pending.id,
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

// "Edit & resubmit": only a rejected request, which goes back to pending under the same id.
export const resubmitHome = async (userId: bigint, requestId: bigint, input: HomeRequestInput): Promise<HomeDto> => {
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.home_request.findFirst({
        where: { id: requestId, user_id: userId, request_status: { code: { not: 'CANCELLED' } } },
        select: { request_status: { select: { code: true } } },
      });
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Home request not found');
      if (current.request_status.code !== 'REJECTED') {
        throw new ApiError(409, 'HOME_NOT_EDITABLE', 'Only a rejected request can be edited and resubmitted');
      }

      const r = await resolveInput(tx, userId, input, requestId);
      const pending = await tx.request_status.findUniqueOrThrow({ where: { code: 'PENDING' }, select: { id: true } });

      // Documents that are no longer part of the request go back to unattached (the 24 h cleanup removes them).
      const dropped = await tx.home_request_document.findMany({
        where: { home_request_id: requestId, upload_id: { notIn: r.documentIds } },
        select: { upload_id: true },
      });
      if (dropped.length > 0) {
        const ids = dropped.map((d) => d.upload_id);
        await tx.home_request_document.deleteMany({ where: { home_request_id: requestId, upload_id: { in: ids } } });
        await tx.upload.updateMany({ where: { id: { in: ids } }, data: { attached_at: null, agreement_start: null, agreement_end: null } });
      }

      await tx.home_request.update({
        where: { id: requestId },
        data: {
          society_id: r.societyId,
          unit_id: r.unitId,
          resident_role_id: r.role.id,
          resident_relation_id: r.relation.id,
          occupancy_status_id: r.occupancy.id,
          request_status_id: pending.id,
          rejection_reason: null,
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date(),
        },
      });
      await attachDocuments(tx, requestId, r);
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
  const cancelled = await prisma.request_status.findUniqueOrThrow({ where: { code: 'CANCELLED' }, select: { id: true } });
  // The status guard keeps this correct if the admin approves at the same moment.
  const done = await prisma.home_request.updateMany({
    where: { id: requestId, user_id: userId, request_status: { code: { in: ['PENDING', 'REJECTED'] } } },
    data: { request_status_id: cancelled.id, updated_at: new Date() },
  });
  if (done.count === 0) throw new ApiError(409, 'HOME_NOT_CANCELLABLE', 'An approved home cannot be cancelled');
};
