import type { Prisma } from '@prisma/client';
import { actorRoleId } from '../../lib/actor-role.js';
import { prisma } from '../../lib/prisma.js';
import { storage } from '../../lib/storage/index.js';
import { claimUploads } from '../../lib/uploads-claim.js';
import { ApiError } from '../../utils/api-error.js';
import { AUDIENCE, getNotice, isEditable, lookupId, noticeLookups, STATUS, today, type Ctx } from './notices.read.js';
import type { CreateNoticeInput, UpdateNoticeInput } from './notices.schema.js';
import type { NoticeDto } from './notices.types.js';

type Tx = Prisma.TransactionClient;

const fieldError = (field: string, message: string) => new ApiError(400, 'VALIDATION_FAILED', message, [{ field, message }]);
const notFound = () => new ApiError(404, 'NOT_FOUND', 'Notice not found');

const dayOf = (v: string) => new Date(`${v}T00:00:00Z`);

// Published, or Expired when the date has already passed (only an unchanged old date on an edit can be).
const statusFor = async (expiresOn: Date | null): Promise<number> => {
  const { statuses } = await noticeLookups();
  return lookupId(statuses, expiresOn && expiresOn < today() ? STATUS.EXPIRED : STATUS.PUBLISHED);
};

const checkExpiry = (value: string | null) => {
  if (value && dayOf(value) < today()) throw fieldError('expiresOn', 'The expiry date cannot be in the past');
};

// The audience decides the blocks: BLOCKS needs at least one block of this society, every other audience has none.
const checkBlocks = async (tx: Tx, societyId: bigint, audienceCode: string, ids: string[]): Promise<bigint[]> => {
  const unique = [...new Set(ids)].map(BigInt);
  if (audienceCode !== AUDIENCE.BLOCKS) {
    if (unique.length > 0) throw fieldError('buildingIds', 'Blocks can only be chosen for "Specific blocks"');
    return [];
  }
  if (unique.length === 0) throw fieldError('buildingIds', 'Choose at least one block');
  const found = await tx.structure.count({ where: { id: { in: unique }, society_id: societyId, is_active: true, structure_type: { is_building: true } } });
  if (found !== unique.length) throw fieldError('buildingIds', 'Choose blocks of this society');
  return unique;
};

// A society has one pinned notice: pinning this one lets go of the other.
const unpinOthers = (tx: Tx, societyId: bigint, keepId?: bigint) =>
  tx.notice.updateMany({ where: { society_id: societyId, is_pinned: true, ...(keepId === undefined ? {} : { id: { not: keepId } }) }, data: { is_pinned: false } });

const audienceOf = async (id: string) => {
  const row = (await noticeLookups()).audiences.find((a) => a.id === Number(id));
  if (!row) throw fieldError('audienceId', 'Choose who should see this notice');
  return row;
};

// ---------------------------------------------------------------- create

export const createNotice = async (ctx: Ctx, input: CreateNoticeInput): Promise<NoticeDto> => {
  const audience = await audienceOf(input.audienceId);
  checkExpiry(input.expiresOn);
  const expiresOn = input.expiresOn ? dayOf(input.expiresOn) : null;

  const id = await prisma.$transaction(async (tx) => {
    const buildings = await checkBlocks(tx, ctx.societyId, audience.code, input.buildingIds);
    const [banner] = input.bannerId ? await claimUploads(tx, ctx.userId, [input.bannerId], 'NOTICE_BANNER', 'bannerId') : [];
    const attachments = await claimUploads(tx, ctx.userId, input.attachmentIds, 'NOTICE_ATTACHMENT', 'attachmentIds');
    if (input.isPinned) await unpinOthers(tx, ctx.societyId);
    const notice = await tx.notice.create({
      data: {
        society_id: ctx.societyId,
        title: input.title,
        body: input.body,
        audience_id: audience.id,
        status_id: await statusFor(expiresOn),
        expires_on: expiresOn,
        is_pinned: input.isPinned,
        banner_upload_id: banner ?? null,
        created_by: ctx.userId,
        created_role_id: await actorRoleId(tx, ctx.societyId, ctx.userId),
      },
      select: { id: true },
    });
    if (buildings.length) await tx.notice_building.createMany({ data: buildings.map((building_id) => ({ notice_id: notice.id, building_id })) });
    if (attachments.length) await tx.notice_attachment.createMany({ data: attachments.map((upload_id) => ({ notice_id: notice.id, upload_id })) });
    return notice.id;
  });
  return getNotice(ctx, id);
};

// ---------------------------------------------------------------- edit

// Removes the upload rows of files that are no longer used; returns their storage keys to delete once the transaction has committed.
const dropUploads = async (tx: Tx, ids: bigint[]): Promise<string[]> => {
  if (ids.length === 0) return [];
  const rows = await tx.upload.findMany({ where: { id: { in: ids } }, select: { storage_key: true } });
  await tx.upload.deleteMany({ where: { id: { in: ids } } });
  return rows.map((r) => r.storage_key);
};

const deleteFiles = async (keys: string[]) => {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (e) {
      console.error('Could not delete notice file', key, e); // the row is gone; the file is an orphan
    }
  }
};

// Everything can change on a live notice, the audience too. Only the fields that are sent change. Expired and deleted notices
// are read only: the date cannot reopen them (decided 2026-10-23).
export const updateNotice = async (ctx: Ctx, noticeId: bigint, input: UpdateNoticeInput): Promise<NoticeDto> => {
  const { statuses } = await noticeLookups();
  const removedKeys = await prisma.$transaction(async (tx) => {
    const current = await tx.notice.findFirst({
      where: { id: noticeId, society_id: ctx.societyId },
      include: { notice_status: { select: { code: true } }, notice_audience: { select: { code: true } }, notice_building: { select: { building_id: true } }, notice_attachment: { select: { upload_id: true } } },
    });
    if (!current) throw notFound();
    if (!isEditable(current)) throw new ApiError(409, 'NOTICE_READ_ONLY', 'An expired or deleted notice cannot be edited');

    const data: Prisma.noticeUncheckedUpdateInput = { updated_by: ctx.userId, updated_at: new Date() };
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;

    // audience and blocks
    const audience = input.audienceId !== undefined ? await audienceOf(input.audienceId) : { id: current.audience_id, code: current.notice_audience.code };
    const audienceChanged = audience.id !== current.audience_id;
    if (audienceChanged || input.buildingIds !== undefined) {
      const ids = input.buildingIds ?? (audienceChanged ? [] : current.notice_building.map((b) => b.building_id.toString()));
      const buildings = await checkBlocks(tx, ctx.societyId, audience.code, ids);
      await tx.notice_building.deleteMany({ where: { notice_id: noticeId } });
      if (buildings.length) await tx.notice_building.createMany({ data: buildings.map((building_id) => ({ notice_id: noticeId, building_id })) });
      data.audience_id = audience.id;
    }

    // expiry and status
    let expiresOn = current.expires_on;
    if (input.expiresOn !== undefined) {
      const changed = (input.expiresOn ?? null) !== (current.expires_on ? current.expires_on.toISOString().slice(0, 10) : null);
      if (changed) checkExpiry(input.expiresOn);
      expiresOn = input.expiresOn ? dayOf(input.expiresOn) : null;
      data.expires_on = expiresOn;
    }
    const statusId = await statusFor(expiresOn);
    data.status_id = statusId;
    const expired = statusId === lookupId(statuses, STATUS.EXPIRED);

    // pin: one per society; an expired notice is not pinned
    const pin = expired ? false : (input.isPinned ?? current.is_pinned);
    if (pin) await unpinOthers(tx, ctx.societyId, noticeId);
    data.is_pinned = pin;

    // files: new ones are claimed, the ones left out are removed
    const dropped: bigint[] = [];
    if (input.bannerId !== undefined) {
      const sameBanner = input.bannerId !== null && current.banner_upload_id?.toString() === input.bannerId;
      if (!sameBanner) {
        const [banner] = input.bannerId ? await claimUploads(tx, ctx.userId, [input.bannerId], 'NOTICE_BANNER', 'bannerId') : [];
        if (current.banner_upload_id) dropped.push(current.banner_upload_id);
        data.banner_upload_id = banner ?? null;
      }
    }
    const droppedAttachments: bigint[] = [];
    if (input.attachmentIds !== undefined) {
      const wanted = [...new Set(input.attachmentIds)].map(BigInt);
      const have = current.notice_attachment.map((a) => a.upload_id);
      const add = wanted.filter((w) => !have.includes(w));
      const remove = have.filter((h) => !wanted.includes(h));
      const claimed = await claimUploads(tx, ctx.userId, add.map(String), 'NOTICE_ATTACHMENT', 'attachmentIds');
      if (remove.length) await tx.notice_attachment.deleteMany({ where: { notice_id: noticeId, upload_id: { in: remove } } });
      if (claimed.length) await tx.notice_attachment.createMany({ data: claimed.map((upload_id) => ({ notice_id: noticeId, upload_id })) });
      droppedAttachments.push(...remove);
    }

    await tx.notice.update({ where: { id: noticeId }, data });
    return dropUploads(tx, [...dropped, ...droppedAttachments]); // after the notice no longer points at the banner
  });
  await deleteFiles(removedKeys);
  return getNotice(ctx, noticeId);
};

// ---------------------------------------------------------------- delete

// A soft delete from any status: the notice stays as a record (DELETED, who and when) with its banner and attachments, it leaves
// the app, the counts and the committee's default list, and the committee can still open it read only.
export const deleteNotice = async (ctx: Ctx, noticeId: bigint): Promise<void> => {
  const { statuses } = await noticeLookups();
  await prisma.$transaction(async (tx) => {
    const n = await tx.notice.findFirst({
      where: { id: noticeId, society_id: ctx.societyId, status_id: { not: lookupId(statuses, STATUS.DELETED) } },
      select: { id: true },
    });
    if (!n) throw notFound();
    await tx.notice.update({
      where: { id: noticeId },
      data: { status_id: lookupId(statuses, STATUS.DELETED), is_pinned: false, deleted_by: ctx.userId, deleted_at: new Date() },
    });
  });
};

// ---------------------------------------------------------------- job

// Hourly: published notices whose expiry date has passed become Expired (and let go of the pin).
export const expireNotices = async (): Promise<number> => {
  const { statuses } = await noticeLookups();
  const { count } = await prisma.notice.updateMany({
    where: { status_id: lookupId(statuses, STATUS.PUBLISHED), expires_on: { lt: today() } },
    data: { status_id: lookupId(statuses, STATUS.EXPIRED), is_pinned: false },
  });
  return count;
};
