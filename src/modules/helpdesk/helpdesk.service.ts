import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { storage } from '../../lib/storage/index.js';
import { actorRoleId } from '../../lib/actor-role.js';
import { claimUploads } from '../../lib/uploads-claim.js';
import { ApiError, type ErrorCode } from '../../utils/api-error.js';
import { getTicket, helpdeskLookups, isCommittee, lookupId, RESIDENT_CANCELLABLE, STATUS, ticketNumber, type Ctx } from './helpdesk.read.js';
import type { CommentInput, CreateTicketInput, UpdateStatusInput } from './helpdesk.schema.js';
import type { AssignableDto, CommentDto, TicketDto } from './helpdesk.types.js';

type Tx = Prisma.TransactionClient;

const fieldError = (status: number, code: ErrorCode, field: string, message: string) => new ApiError(status, code, message, [{ field, message }]);
const notFound = () => new ApiError(404, 'NOT_FOUND', 'Complaint not found');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You are not allowed to do this');
const invalidTransition = (message: string) => new ApiError(409, 'TICKET_INVALID_TRANSITION', message);

// ---------------------------------------------------------------- shared pieces

// A complaint of this society the caller may see (404 otherwise).
const loadTicket = async (tx: Tx, ctx: Ctx, ticketId: bigint) => {
  const t = await tx.ticket.findFirst({
    where: {
      id: ticketId,
      society_id: ctx.societyId,
      ...(isCommittee(ctx) ? {} : { OR: [{ raised_by: ctx.userId }, { ticket_request_type: { code: 'SOCIETY' } }] }),
    },
    select: { id: true, raised_by: true, assignee_id: true, status_id: true, ticket_status: { select: { code: true } } },
  });
  if (!t) throw notFound();
  return { ...t, status: t.ticket_status.code };
};

const touch = (tx: Tx, ticketId: bigint, data: Prisma.ticketUncheckedUpdateInput = {}) =>
  tx.ticket.update({ where: { id: ticketId }, data: { ...data, updated_at: new Date() } });

// ---------------------------------------------------------------- raise

export const createTicket = async (ctx: Ctx, input: CreateTicketInput): Promise<TicketDto> => {
  const lk = await helpdeskLookups();
  const category = lk.categories.find((c) => c.id === Number(input.categoryId));
  if (!category) throw fieldError(400, 'VALIDATION_FAILED', 'categoryId', 'Choose a category');
  if (input.locationId && !lk.locations.some((l) => l.id === Number(input.locationId))) throw fieldError(400, 'VALIDATION_FAILED', 'locationId', 'Choose where the issue is');

  const id = await prisma.$transaction(async (tx) => {
    let unitId: bigint | null = null;
    if (input.requestType === 'UNIT') {
      const home = await tx.user_resident_map.findFirst({
        where: { id: BigInt(input.homeId!), user_id: ctx.userId, society_id: ctx.societyId, is_active: true, move_out_date: null },
        select: { unit_id: true },
      });
      if (!home) throw new ApiError(403, 'HOME_NOT_APPROVED', 'This home is not approved for you');
      unitId = home.unit_id;
    }
    const photos = await claimUploads(tx, ctx.userId, input.photoIds, 'TICKET_PHOTO');

    // the society's next number, never reused
    const counter = await tx.$queryRaw<{ last_no: number }[]>`
      INSERT INTO ticket_counter (society_id, last_no) VALUES (${ctx.societyId}, 1)
      ON CONFLICT (society_id) DO UPDATE SET last_no = ticket_counter.last_no + 1
      RETURNING last_no`;
    const ticketNo = counter[0]!.last_no;

    const open = lookupId(lk.status, STATUS.OPEN);
    const ticket = await tx.ticket.create({
      data: {
        society_id: ctx.societyId,
        ticket_no: ticketNo,
        unit_id: unitId,
        raised_by: ctx.userId,
        request_type_id: lookupId(lk.requestType, input.requestType),
        category_id: category.id,
        location_id: input.locationId ? Number(input.locationId) : null,
        priority_id: lookupId(lk.priority, input.priority),
        title: input.title,
        description: input.description,
        status_id: open,
      },
      select: { id: true },
    });
    await tx.ticket_event.create({
      data: { ticket_id: ticket.id, event_type_id: lookupId(lk.eventType, 'RAISED'), status_id: open, actor_id: ctx.userId, actor_role_id: await actorRoleId(tx, ctx.societyId, ctx.userId) },
    });
    if (photos.length) await tx.ticket_photo.createMany({ data: photos.map((upload_id) => ({ ticket_id: ticket.id, upload_id })) });
    return ticket.id;
  });
  return getTicket(ctx, id);
};

// ---------------------------------------------------------------- assign

// Committee members of the current term whose role lets them see complaints: the only people a complaint can be given to.
const eligibleAssignees = (tx: Tx, societyId: bigint, userId?: bigint) =>
  tx.user_society_role.findMany({
    where: {
      society_id: societyId,
      ...(userId === undefined ? {} : { user_id: userId }),
      end_date: null,
      is_active: true,
      committee_term: { closed_at: null },
      role: { is_active: true, role_permission: { some: { permission: { code: 'TICKET_VIEW_ALL', is_active: true } } } },
    },
    select: { user_id: true, app_user_user_society_role_user_idToapp_user: { select: { full_name: true } }, role: { select: { name: true, sort_order: true } } },
  });

export const listAssignees = async (ctx: Ctx): Promise<AssignableDto[]> => {
  const rows = await eligibleAssignees(prisma, ctx.societyId);
  const people = new Map<bigint, { name: string; role: string; sort: number }>();
  for (const r of rows) {
    const known = people.get(r.user_id);
    if (!known || r.role.sort_order < known.sort) people.set(r.user_id, { name: r.app_user_user_society_role_user_idToapp_user.full_name, role: r.role.name, sort: r.role.sort_order });
  }
  return [...people]
    .sort(([, a], [, b]) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map(([id, p]) => ({ id: id.toString(), name: p.name, role: p.role, isMe: id === ctx.userId }));
};

// The first assignment acknowledges an open complaint; later ones are reassignments and never change the status.
export const assignTicket = async (ctx: Ctx, ticketId: bigint, assigneeId: bigint): Promise<TicketDto> => {
  const lk = await helpdeskLookups();
  await prisma.$transaction(async (tx) => {
    const t = await loadTicket(tx, ctx, ticketId);
    if (lk.finalStatuses.has(t.status)) throw invalidTransition('A resolved or cancelled complaint cannot be assigned');
    if (t.assignee_id === assigneeId) throw fieldError(400, 'VALIDATION_FAILED', 'assigneeId', 'This complaint is already assigned to this person');
    const [assignee] = await eligibleAssignees(tx, ctx.societyId, assigneeId);
    if (!assignee) throw fieldError(400, 'VALIDATION_FAILED', 'assigneeId', 'Choose a member of the current committee');
    const first = t.assignee_id === null;
    const statusId = first && t.status === STATUS.OPEN ? lookupId(lk.status, STATUS.ACKNOWLEDGED) : t.status_id;
    await tx.ticket_event.create({
      data: {
        ticket_id: t.id,
        event_type_id: lookupId(lk.eventType, first ? 'ASSIGNED' : 'REASSIGNED'),
        status_id: statusId,
        actor_id: ctx.userId,
        actor_role_id: await actorRoleId(tx, ctx.societyId, ctx.userId),
        assignee_id: assigneeId,
        note: `Assigned to ${assignee.app_user_user_society_role_user_idToapp_user.full_name}`,
      },
    });
    await touch(tx, t.id, { assignee_id: assigneeId, status_id: statusId });
  });
  return getTicket(ctx, ticketId);
};

// ---------------------------------------------------------------- status

// One status change: the committee may move a complaint to any status except after it is resolved or cancelled.
const changeStatus = async (tx: Tx, ctx: Ctx, t: Awaited<ReturnType<typeof loadTicket>>, input: UpdateStatusInput) => {
  const lk = await helpdeskLookups();
  const note = input.note?.trim() || null;
  if (lk.finalStatuses.has(t.status)) throw invalidTransition('A resolved or cancelled complaint cannot be changed');
  const target = lk.statuses.find((s) => s.id === Number(input.status));
  if (!target) throw fieldError(400, 'VALIDATION_FAILED', 'status', 'Choose a valid status');
  if (target.code === t.status) throw fieldError(400, 'VALIDATION_FAILED', 'status', 'The complaint already has this status');
  if (target.code === STATUS.RESOLVED && !note) throw fieldError(400, 'VALIDATION_FAILED', 'note', 'Enter the resolution note');
  if (target.code === STATUS.CANCELLED && !note) throw fieldError(400, 'VALIDATION_FAILED', 'note', 'Enter the reason for cancelling');
  if (target.code === STATUS.INFO_NEEDED && !note) throw fieldError(400, 'VALIDATION_FAILED', 'note', 'Write the question for the resident');
  if (input.photoIds.length > 0 && target.code !== STATUS.RESOLVED) throw fieldError(400, 'VALIDATION_FAILED', 'photoIds', 'Photos can only be added when resolving');

  const roleId = await actorRoleId(tx, ctx.societyId, ctx.userId);
  const statusId = target.id;
  const photos = await claimUploads(tx, ctx.userId, input.photoIds, 'TICKET_RESOLUTION_PHOTO');
  const event = await tx.ticket_event.create({
    data: {
      ticket_id: t.id,
      event_type_id: lookupId(lk.eventType, 'STATUS_CHANGED'),
      status_id: statusId,
      actor_id: ctx.userId,
      actor_role_id: roleId,
      // "Ask for info" keeps its question in the comment below, not in the timeline note
      note: target.code === STATUS.INFO_NEEDED ? null : note,
    },
    select: { id: true },
  });
  if (photos.length) await tx.ticket_photo.createMany({ data: photos.map((upload_id) => ({ ticket_id: t.id, upload_id, event_id: event.id })) });
  if (target.code === STATUS.INFO_NEEDED) {
    await tx.ticket_comment.create({ data: { ticket_id: t.id, author_id: ctx.userId, author_role_id: roleId, body: note! } });
  }
  await touch(tx, t.id, { status_id: statusId });
};

export const updateStatus = async (ctx: Ctx, ticketId: bigint, input: UpdateStatusInput): Promise<TicketDto> => {
  await prisma.$transaction(async (tx) => changeStatus(tx, ctx, await loadTicket(tx, ctx, ticketId), input));
  return getTicket(ctx, ticketId);
};

// The resident withdraws their own complaint while it is open, acknowledged or waiting for them.
export const cancelTicket = async (ctx: Ctx, ticketId: bigint, reason: string): Promise<TicketDto> => {
  await prisma.$transaction(async (tx) => {
    const t = await loadTicket(tx, ctx, ticketId);
    if (t.raised_by !== ctx.userId) throw forbidden();
    if (!RESIDENT_CANCELLABLE.includes(t.status)) throw invalidTransition('This complaint can no longer be cancelled');
    await changeStatus(tx, ctx, t, { status: lookupId((await helpdeskLookups()).status, STATUS.CANCELLED).toString(), note: reason, photoIds: [] });
  });
  return getTicket(ctx, ticketId);
};

// ---------------------------------------------------------------- comments

const commentWithPhotos = (id: bigint) => ({ where: { id }, include: { ticket_comment_photo: { include: { upload: { select: { id: true, storage_key: true } } } } } });

const requireCommenter = (ctx: Ctx, t: { raised_by: bigint }) => {
  if (t.raised_by !== ctx.userId && !isCommittee(ctx)) throw forbidden();
};

// In every status, including resolved and cancelled; a comment never changes the status.
export const addComment = async (ctx: Ctx, ticketId: bigint, input: CommentInput): Promise<CommentDto> => {
  const id = await prisma.$transaction(async (tx) => {
    const t = await loadTicket(tx, ctx, ticketId);
    requireCommenter(ctx, t);
    const photos = await claimUploads(tx, ctx.userId, input.photoIds, 'TICKET_COMMENT_PHOTO');
    const comment = await tx.ticket_comment.create({
      data: { ticket_id: t.id, author_id: ctx.userId, author_role_id: await actorRoleId(tx, ctx.societyId, ctx.userId), body: input.body },
      select: { id: true },
    });
    if (photos.length) await tx.ticket_comment_photo.createMany({ data: photos.map((upload_id) => ({ comment_id: comment.id, upload_id })) });
    await touch(tx, t.id);
    return comment.id;
  });
  return findComment(ctx, ticketId, id);
};

const findComment = async (ctx: Ctx, ticketId: bigint, commentId: bigint): Promise<CommentDto> => {
  const found = (await getTicket(ctx, ticketId)).comments.find((c) => c.id === commentId.toString());
  if (!found) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return found;
};

// Only the author edits their own comment (its text; the photos stay).
export const editComment = async (ctx: Ctx, ticketId: bigint, commentId: bigint, body: string): Promise<CommentDto> => {
  await prisma.$transaction(async (tx) => {
    await loadTicket(tx, ctx, ticketId);
    const c = await tx.ticket_comment.findFirst({ where: { id: commentId, ticket_id: ticketId }, select: { author_id: true, body: true } });
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    if (c.author_id !== ctx.userId) throw forbidden();
    if (c.body !== body) await tx.ticket_comment.update({ where: { id: commentId }, data: { body, edited_at: new Date() } });
  });
  return findComment(ctx, ticketId, commentId);
};

// A real delete: the comment, its photo links and the photo files leave no trace (decided 2026-10-18).
export const deleteComment = async (ctx: Ctx, ticketId: bigint, commentId: bigint): Promise<void> => {
  const keys = await prisma.$transaction(async (tx) => {
    await loadTicket(tx, ctx, ticketId);
    const c = await tx.ticket_comment.findFirst({ ...commentWithPhotos(commentId), where: { id: commentId, ticket_id: ticketId } });
    if (!c) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    if (c.author_id !== ctx.userId) throw forbidden();
    await tx.ticket_comment_photo.deleteMany({ where: { comment_id: commentId } });
    await tx.ticket_comment.delete({ where: { id: commentId } });
    const uploadIds = c.ticket_comment_photo.map((p) => p.upload.id);
    if (uploadIds.length) await tx.upload.deleteMany({ where: { id: { in: uploadIds } } });
    return c.ticket_comment_photo.map((p) => p.upload.storage_key);
  });
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (e) {
      console.error('Could not delete comment photo', key, e); // the row is gone; the file is an orphan
    }
  }
};

export { ticketNumber };
