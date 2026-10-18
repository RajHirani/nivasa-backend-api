import { Prisma } from '@prisma/client';
import { buildingDto, flatDto, unitInclude, type UnitRow } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import { CACHE_KEYS, cached } from '../../lib/static-cache.js';
import { ApiError } from '../../utils/api-error.js';
import { toUploadDto } from '../uploads/uploads.service.js';
import type {
  ActorDto, AllowedActionsDto, AssigneeDto, CommentDto, HelpDeskOptionsDto, RaisedByDto, TicketDto, TicketListDto, TicketSummaryCountsDto, TicketSummaryDto, TimelineEntryDto,
} from './helpdesk.types.js';
import type { ListTicketsInput } from './helpdesk.schema.js';

// Who is asking: the active society (X-Society-Id) and what the caller holds there.
export interface Ctx {
  societyId: bigint;
  userId: bigint;
  permissions: ReadonlySet<string>;
}
export const isCommittee = (ctx: Ctx) => ctx.permissions.has('TICKET_VIEW_ALL');

// The statuses the rules below name: where a complaint starts, what the first assignment does, what needs a note, what a resident may
// cancel. Which statuses exist, their names and which are final (`is_final`) come from the DB lookup table, not from here.
export const STATUS = { OPEN: 'OPEN', ACKNOWLEDGED: 'ACKNOWLEDGED', INFO_NEEDED: 'INFO_NEEDED', RESOLVED: 'RESOLVED', CANCELLED: 'CANCELLED' } as const;
export const RESIDENT_CANCELLABLE: string[] = [STATUS.OPEN, STATUS.ACKNOWLEDGED, STATUS.INFO_NEEDED];

export const ticketNumber = (no: number) => `HD-${String(no).padStart(4, '0')}`;

// ---------------------------------------------------------------- lookups (code -> id), read once

export const helpdeskLookups = () =>
  cached(CACHE_KEYS.HELPDESK_LOOKUPS, async () => {
    const byCode = (rows: { id: number; code: string }[]) => new Map(rows.map((r) => [r.code, r.id]));
    const sel = { select: { id: true, code: true } };
    const [statusRows, priority, requestType, eventType, categories, locations] = await Promise.all([
      prisma.ticket_status.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, code: true, name: true, is_final: true } }),
      prisma.ticket_priority.findMany(sel),
      prisma.ticket_request_type.findMany(sel),
      prisma.ticket_event_type.findMany(sel),
      prisma.ticket_category.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, code: true, name: true } }),
      prisma.ticket_location.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, code: true, name: true } }),
    ]);
    return { status: byCode(statusRows), statuses: statusRows.map((s) => ({ id: s.id, code: s.code, name: s.name })), finalStatuses: new Set(statusRows.filter((s) => s.is_final).map((s) => s.code)), priority: byCode(priority), requestType: byCode(requestType), eventType: byCode(eventType), categories, locations };
  });

export const lookupId = (ids: Map<string, number>, code: string): number => {
  const id = ids.get(code);
  if (id === undefined) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return id;
};

export const getOptions = async (): Promise<HelpDeskOptionsDto> => {
  const { statuses, categories, locations } = await helpdeskLookups();
  return {
    statuses: statuses.map((s) => ({ id: s.id.toString(), code: s.code, name: s.name })),
    categories: categories.map((c) => ({ id: c.id.toString(), name: c.name })),
    locations: locations.map((l) => ({ id: l.id.toString(), name: l.name })),
  };
};

// ---------------------------------------------------------------- people

const personSelect = { id: true, full_name: true, phone: true, country: { select: { dial_code: true } } } satisfies Prisma.app_userSelect;
type PersonRow = Prisma.app_userGetPayload<{ select: typeof personSelect }>;

const phoneOf = (u: PersonRow) => ({ countryCode: u.country.dial_code, mobile: u.phone.slice(u.country.dial_code.length) });

const flatLabel = (unit: UnitRow | null): string | null => {
  if (!unit) return null;
  const building = buildingDto(unit);
  return building ? `${building.name}-${flatDto(unit).code}` : flatDto(unit).code;
};

// The committee role of each person today (the one listed first), for the assignee line.
const committeeRoleNames = async (societyId: bigint, userIds: bigint[]): Promise<Map<bigint, string>> => {
  const best = new Map<bigint, { name: string; sort: number }>();
  if (userIds.length === 0) return new Map();
  const rows = await prisma.user_society_role.findMany({
    where: { society_id: societyId, user_id: { in: userIds }, end_date: null, is_active: true, role: { is_active: true } },
    select: { user_id: true, role: { select: { name: true, sort_order: true } } },
  });
  for (const r of rows) {
    const known = best.get(r.user_id);
    if (!known || r.role.sort_order < known.sort) best.set(r.user_id, { name: r.role.name, sort: r.role.sort_order });
  }
  return new Map([...best].map(([k, v]) => [k, v.name]));
};

// ---------------------------------------------------------------- summaries (list)

const summaryInclude = {
  ticket_status: { select: { code: true, name: true } },
  ticket_priority: { select: { code: true, name: true } },
  ticket_category: { select: { name: true } },
  ticket_request_type: { select: { code: true, name: true } },
  structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
  app_user_ticket_raised_byToapp_user: { select: personSelect },
  app_user_ticket_assignee_idToapp_user: { select: personSelect },
} satisfies Prisma.ticketInclude;
type TicketRow = Prisma.ticketGetPayload<{ include: typeof summaryInclude }>;

// The assignee's committee role is looked up only for one complaint (`withAssigneeRole`), not for the list.
const toSummaries = async (ctx: Ctx, rows: TicketRow[], withAssigneeRole = false): Promise<TicketSummaryDto[]> => {
  const committee = isCommittee(ctx);
  const roles = withAssigneeRole ? await committeeRoleNames(ctx.societyId, rows.flatMap((r) => (r.assignee_id ? [r.assignee_id] : []))) : null;
  return rows.map((t): TicketSummaryDto => {
    const raiser = t.app_user_ticket_raised_byToapp_user;
    const assignee = t.app_user_ticket_assignee_idToapp_user;
    const raisedBy: RaisedByDto = {
      id: raiser.id.toString(),
      name: raiser.full_name,
      flat: flatLabel(t.structure),
      isMe: raiser.id === ctx.userId,
      ...(committee ? phoneOf(raiser) : {}),
    };
    const assigneeDto: AssigneeDto | null = assignee
      ? { id: assignee.id.toString(), name: assignee.full_name, ...(roles && { role: roles.get(assignee.id) ?? null }), isMe: assignee.id === ctx.userId, ...(committee ? phoneOf(assignee) : {}) }
      : null;
    return {
      id: t.id.toString(),
      ticketNumber: ticketNumber(t.ticket_no),
      requestType: { code: t.ticket_request_type.code, name: t.ticket_request_type.name },
      category: t.ticket_category.name,
      title: t.title,
      priority: { code: t.ticket_priority.code, name: t.ticket_priority.name },
      status: { code: t.ticket_status.code, name: t.ticket_status.name },
      createdAt: t.created_at.toISOString(),
      raisedBy,
      assignee: assigneeDto,
    };
  });
};

// The committee sees every complaint of the society; a resident sees theirs and every society-level one.
export const visibleTo = (ctx: Ctx): Prisma.ticketWhereInput =>
  isCommittee(ctx) ? { society_id: ctx.societyId } : { society_id: ctx.societyId, OR: [{ raised_by: ctx.userId }, { ticket_request_type: { code: 'SOCIETY' } }] };

export const listTickets = async (ctx: Ctx, f: ListTicketsInput): Promise<TicketListDto> => {
  const committee = isCommittee(ctx);
  if (f.scope === 'assigned_to_me' && !committee) throw new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
  const and: Prisma.ticketWhereInput[] = [visibleTo(ctx)];

  if (f.status) and.push({ status_id: { in: f.status.map(Number) } });
  if (f.categoryId) and.push({ category_id: Number(f.categoryId) });
  if (f.scope === 'raised_by_me') and.push({ raised_by: ctx.userId });
  if (f.scope === 'assigned_to_me') and.push({ assignee_id: ctx.userId });
  if (f.unassigned !== undefined) {
    if (!committee) throw new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
    and.push(f.unassigned ? { assignee_id: null } : { assignee_id: { not: null } });
  }
  // Search is by title only.
  if (f.q) and.push({ title: { contains: f.q, mode: 'insensitive' } });

  const where: Prisma.ticketWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: f.page * f.pageSize, take: f.pageSize, include: summaryInclude }),
  ]);
  return { items: await toSummaries(ctx, rows), total };
};

// Counts for the Dashboard (committee only: the route needs TICKET_VIEW_ALL).
export const ticketCounts = async (ctx: Ctx): Promise<TicketSummaryCountsDto> => {
  const { statuses } = await helpdeskLookups();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [grouped, thisMonth] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status_id'], where: { society_id: ctx.societyId }, _count: { _all: true } }),
    prisma.ticket.count({ where: { society_id: ctx.societyId, created_at: { gte: monthStart } } }),
  ]);
  const counts = new Map(grouped.map((g) => [g.status_id, g._count._all]));
  return { thisMonth, byStatus: statuses.map((s) => ({ id: s.id.toString(), code: s.code, name: s.name, count: counts.get(s.id) ?? 0 })) };
};

// ---------------------------------------------------------------- one complaint

const detailInclude = {
  ...summaryInclude,
  ticket_location: { select: { name: true } },
  ticket_photo: { orderBy: { created_at: 'asc' }, include: { upload: { include: { upload_purpose: { select: { code: true } } } } } },
  ticket_event: {
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: {
      ticket_event_type: { select: { code: true, name: true } },
      ticket_status: { select: { code: true, name: true } },
      role: { select: { name: true } },
      app_user_ticket_event_actor_idToapp_user: { select: { id: true, full_name: true } },
      app_user_ticket_event_assignee_idToapp_user: { select: { full_name: true } },
    },
  },
  ticket_comment: {
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: {
      app_user: { select: { id: true, full_name: true } },
      role: { select: { name: true } },
      ticket_comment_photo: { orderBy: { created_at: 'asc' }, include: { upload: { include: { upload_purpose: { select: { code: true } } } } } },
    },
  },
} satisfies Prisma.ticketInclude;
type DetailRow = Prisma.ticketGetPayload<{ include: typeof detailInclude }>;

export const allowedActions = async (ctx: Ctx, t: { raised_by: bigint; status: string }): Promise<AllowedActionsDto> => {
  const { statuses, finalStatuses } = await helpdeskLookups();
  const final = finalStatuses.has(t.status);
  const raiser = t.raised_by === ctx.userId;
  return {
    canCancel: raiser && RESIDENT_CANCELLABLE.includes(t.status),
    canAssign: ctx.permissions.has('TICKET_ASSIGN') && !final,
    canComment: raiser || isCommittee(ctx),
    statusUpdates: ctx.permissions.has('TICKET_RESOLVE') && !final ? statuses.filter((s) => s.code !== t.status).map((s) => ({ id: s.id.toString(), code: s.code, name: s.name })) : [],
  };
};

const toDetail = async (ctx: Ctx, t: DetailRow): Promise<TicketDto> => {
  const [summary] = await toSummaries(ctx, [t], true);
  if (!summary) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  const flat = flatLabel(t.structure);
  const actor = (u: { id: bigint; full_name: string }, role: { name: string } | null): ActorDto => ({
    id: u.id.toString(),
    name: u.full_name,
    role: role?.name ?? null,
    flat: role ? null : u.id === t.raised_by ? flat : null,
    isMe: u.id === ctx.userId,
  });

  const timeline: TimelineEntryDto[] = await Promise.all(
    t.ticket_event.map(async (e) => ({
      type: { code: e.ticket_event_type.code, name: e.ticket_event_type.name },
      status: { code: e.ticket_status.code, name: e.ticket_status.name },
      at: e.created_at.toISOString(),
      by: actor(e.app_user_ticket_event_actor_idToapp_user, e.role),
      assignee: e.app_user_ticket_event_assignee_idToapp_user?.full_name ?? null,
      note: e.note,
      photos: await Promise.all(t.ticket_photo.filter((p) => p.event_id === e.id).map((p) => toUploadDto(p.upload))),
    })),
  );
  const comments: CommentDto[] = await Promise.all(
    t.ticket_comment.map(async (c) => ({
      id: c.id.toString(),
      body: c.body,
      author: actor(c.app_user, c.role),
      createdAt: c.created_at.toISOString(),
      editedAt: c.edited_at?.toISOString() ?? null,
      photos: await Promise.all(c.ticket_comment_photo.map((p) => toUploadDto(p.upload))),
      canEdit: c.author_id === ctx.userId,
      canDelete: c.author_id === ctx.userId,
    })),
  );
  return {
    ...summary,
    location: t.ticket_location?.name ?? null,
    description: t.description,
    photos: await Promise.all(t.ticket_photo.filter((p) => p.event_id === null).map((p) => toUploadDto(p.upload))),
    timeline,
    comments,
    allowedActions: await allowedActions(ctx, { raised_by: t.raised_by, status: summary.status.code }),
  };
};

// 404 (not 403) when the caller may not see it, so ids of private complaints do not leak.
export const getTicket = async (ctx: Ctx, ticketId: bigint): Promise<TicketDto> => {
  const row = await prisma.ticket.findFirst({ where: { AND: [visibleTo(ctx), { id: ticketId }] }, include: detailInclude });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Complaint not found');
  return toDetail(ctx, row);
};
