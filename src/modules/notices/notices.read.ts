import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { CACHE_KEYS, cached } from '../../lib/static-cache.js';
import { ApiError } from '../../utils/api-error.js';
import { decodeCursor, encodeCursor } from '../../utils/cursor.js';
import { dayString } from '../../utils/date.js';
import { toUploadDto } from '../uploads/uploads.service.js';
import type { ListNoticesInput } from './notices.schema.js';
import type { LookupDto, NoticeCursorListDto, NoticeDto, NoticeListDto, NoticeOptionsDto, NoticeSummaryDto } from './notices.types.js';

// Who is asking: the active society (X-Society-Id) and what the caller holds there.
export interface Ctx {
  societyId: bigint;
  userId: bigint;
  permissions: ReadonlySet<string>;
}
// NOTICE_POST creates, edits, pins and deletes, and sees expired notices too; NOTICE_VIEW reads what the app shows.
export const canManage = (ctx: Ctx) => ctx.permissions.has('NOTICE_POST');

export const STATUS = { PUBLISHED: 'PUBLISHED', EXPIRED: 'EXPIRED', DELETED: 'DELETED' } as const;
export const AUDIENCE = { ALL: 'ALL', BLOCKS: 'BLOCKS', OWNERS: 'OWNERS', TENANTS: 'TENANTS' } as const;

// A notice shows until the end of its expiry date in the society's day. Every society is in India for now.
const SOCIETY_TIME_ZONE = 'Asia/Kolkata';
export const today = (): Date => new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: SOCIETY_TIME_ZONE }).format(new Date())}T00:00:00Z`);

// ---------------------------------------------------------------- lookups (code -> id), read once

export const noticeLookups = () =>
  cached(CACHE_KEYS.NOTICE_LOOKUPS, async () => {
    const [audiences, statuses] = await Promise.all([
      prisma.notice_audience.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, code: true, name: true } }),
      prisma.notice_status.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' }, select: { id: true, code: true, name: true } }),
    ]);
    return { audiences, statuses };
  });

export const lookupId = (rows: { id: number; code: string }[], code: string): number => {
  const row = rows.find((r) => r.code === code);
  if (!row) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return row.id;
};

const lookupDto = (r: { id: number; code: string; name: string }): LookupDto => ({ id: r.id.toString(), code: r.code, name: r.name });

export const getOptions = async (): Promise<NoticeOptionsDto> => {
  const { audiences, statuses } = await noticeLookups();
  return { audiences: audiences.map(lookupDto), statuses: statuses.map(lookupDto) };
};

// ---------------------------------------------------------------- what a status means right now

// Published and Expired follow the expiry date even before the hourly job has caught up, so nothing stale shows.
const isLive = (publishedId: number): Prisma.noticeWhereInput => ({
  status_id: publishedId,
  OR: [{ expires_on: null }, { expires_on: { gte: today() } }],
});
const isExpired = (publishedId: number, expiredId: number): Prisma.noticeWhereInput => ({
  OR: [{ status_id: expiredId }, { status_id: publishedId, expires_on: { lt: today() } }],
});

// What a resident (or anyone browsing as the app does) may see: live, for an audience that includes them.
const visibleToResident = async (ctx: Ctx, publishedId: number): Promise<Prisma.noticeWhereInput> => {
  const homes = await prisma.user_resident_map.findMany({
    where: { user_id: ctx.userId, society_id: ctx.societyId, is_active: true, move_out_date: null },
    select: { resident_role: { select: { code: true } }, structure: { select: { building_id: true } } },
  });
  const buildingIds = [...new Set(homes.flatMap((h) => (h.structure.building_id ? [h.structure.building_id] : [])))];
  const audience: Prisma.noticeWhereInput[] = [{ notice_audience: { code: AUDIENCE.ALL } }];
  if (homes.some((h) => h.resident_role.code === 'OWNER')) audience.push({ notice_audience: { code: AUDIENCE.OWNERS } });
  if (homes.some((h) => h.resident_role.code === 'TENANT')) audience.push({ notice_audience: { code: AUDIENCE.TENANTS } });
  if (buildingIds.length) audience.push({ notice_audience: { code: AUDIENCE.BLOCKS }, notice_building: { some: { building_id: { in: buildingIds } } } });
  return { AND: [isLive(publishedId), { OR: audience }] };
};

// ---------------------------------------------------------------- mapping

const listInclude = {
  notice_audience: { select: { id: true, code: true, name: true } },
  notice_status: { select: { id: true, code: true, name: true } },
  notice_building: { select: { structure: { select: { id: true, identifier: true, sort_order: true } } } },
  notice_attachment: { select: { upload: { select: { content_type: true } } } },
  upload: { select: { id: true } }, // the banner
} satisfies Prisma.noticeInclude;
type ListRow = Prisma.noticeGetPayload<{ include: typeof listInclude }>;

const detailInclude = {
  ...listInclude,
  notice_attachment: { orderBy: { created_at: 'asc' }, select: { upload: { include: { upload_purpose: { select: { code: true } } } } } },
  upload: { include: { upload_purpose: { select: { code: true } } } },
  app_user_notice_created_byToapp_user: { select: { full_name: true } },
  role: { select: { name: true } },
} satisfies Prisma.noticeInclude;
type DetailRow = Prisma.noticeGetPayload<{ include: typeof detailInclude }>;

const EXCERPT_LENGTH = 160;
const excerptOf = (body: string) => {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
};

// Only a live notice can be edited: expired (even before the hourly job stores it) and deleted ones are read only.
export const isEditable = (n: { notice_status: { code: string }; expires_on: Date | null }): boolean =>
  n.notice_status.code === STATUS.PUBLISHED && !(n.expires_on !== null && n.expires_on < today());

const toSummary = (ctx: Ctx, n: ListRow, statuses: { id: number; code: string; name: string }[]): NoticeSummaryDto => {
  // a published notice past its date reads as expired until the hourly job stores it
  const expired = n.notice_status.code === STATUS.PUBLISHED && n.expires_on !== null && n.expires_on < today();
  const status = expired ? statuses.find((s) => s.code === STATUS.EXPIRED)! : n.notice_status;
  return {
    id: n.id.toString(),
    title: n.title,
    excerpt: excerptOf(n.body),
    publishedAt: n.created_at.toISOString(),
    attachmentCount: n.notice_attachment.length,
    hasImages: n.upload !== null || n.notice_attachment.some((a) => a.upload.content_type.startsWith('image/')),
    status: lookupDto(status),
    audience: lookupDto(n.notice_audience),
    buildings: n.notice_building
      .map((b) => b.structure)
      .sort((a, b) => a.sort_order - b.sort_order || a.identifier.localeCompare(b.identifier))
      .map((b) => ({ id: b.id.toString(), name: b.identifier })),
    isPinned: n.is_pinned && !expired,
    expiresOn: n.expires_on ? dayString(n.expires_on) : null,
    canEdit: canManage(ctx) && isEditable(n),
    canDelete: canManage(ctx) && n.notice_status.code !== STATUS.DELETED,
  };
};

const toDetail = async (ctx: Ctx, n: DetailRow, statuses: { id: number; code: string; name: string }[]): Promise<NoticeDto> => ({
  ...toSummary(ctx, n, statuses),
  description: n.body,
  banner: n.upload ? await toUploadDto(n.upload) : null,
  attachments: await Promise.all(n.notice_attachment.map((a) => toUploadDto(a.upload))),
  postedBy: { name: n.app_user_notice_created_byToapp_user.full_name, role: n.role?.name ?? null },
  updatedAt: n.updated_at.toISOString(),
});

// ---------------------------------------------------------------- reads

const ORDER: Prisma.noticeOrderByWithRelationInput[] = [{ is_pinned: 'desc' }, { id: 'desc' }]; // pinned first, then newest (ids grow with time)

// Offset mode (`?page=`, the portal): the committee (NOTICE_POST) sees every notice of the society, deleted ones included, and can
// filter by status; anyone else with NOTICE_VIEW sees what the app shows. Both can search the title.
// Without `page` (the app, or the committee previewing it): live notices for the caller's audience, by cursor.
export const listNotices = async (ctx: Ctx, input: ListNoticesInput): Promise<NoticeListDto | NoticeCursorListDto> => {
  const { audiences: _a, statuses } = await noticeLookups();
  const published = lookupId(statuses, STATUS.PUBLISHED);
  const expired = lookupId(statuses, STATUS.EXPIRED);

  if (input.page !== undefined) {
    const deleted = lookupId(statuses, STATUS.DELETED);
    const manage = canManage(ctx);
    const and: Prisma.noticeWhereInput[] = [{ society_id: ctx.societyId }];
    if (!manage) and.push(await visibleToResident(ctx, published));
    if (input.q) and.push({ title: { contains: input.q, mode: 'insensitive' } });
    if (input.status && manage) {
      const wanted = Number(input.status);
      if (wanted === published) and.push(isLive(published));
      else if (wanted === expired) and.push(isExpired(published, expired));
      else if (wanted === deleted) and.push({ status_id: deleted });
      else throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'status', message: 'Choose a valid status' }]);
    }
    const where: Prisma.noticeWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      prisma.notice.findMany({ where, orderBy: ORDER, skip: input.page * input.pageSize, take: input.pageSize, include: listInclude }),
      prisma.notice.count({ where }),
    ]);
    return { items: rows.map((n) => toSummary(ctx, n, statuses)), total };
  }

  const after = decodeCursor<{ p: boolean; i: string }>(input.cursor);
  if (input.cursor && !after) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'cursor', message: 'Invalid cursor' }]);
  const and: Prisma.noticeWhereInput[] = [{ society_id: ctx.societyId }, canManage(ctx) ? isLive(published) : await visibleToResident(ctx, published)];
  if (after) {
    const id = BigInt(after.i);
    and.push({ OR: [...(after.p ? [{ is_pinned: false }] : []), { is_pinned: after.p, id: { lt: id } }] });
  }
  const rows = await prisma.notice.findMany({ where: { AND: and }, orderBy: ORDER, take: input.limit + 1, include: listInclude });
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((n) => toSummary(ctx, n, statuses)),
    nextCursor: rows.length > input.limit && last ? encodeCursor({ p: last.is_pinned, i: last.id.toString() }) : null,
  };
};

export const getNotice = async (ctx: Ctx, noticeId: bigint): Promise<NoticeDto> => {
  const { statuses } = await noticeLookups();
  const published = lookupId(statuses, STATUS.PUBLISHED);
  // the committee also opens expired and deleted notices (read only); residents only see what the app lists
  const where: Prisma.noticeWhereInput = canManage(ctx) ? {} : await visibleToResident(ctx, published);
  const row = await prisma.notice.findFirst({ where: { AND: [{ id: noticeId, society_id: ctx.societyId }, where] }, include: detailInclude });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Notice not found');
  return toDetail(ctx, row, statuses);
};

// The Dashboard's "Active notices": published and not past their date.
export const noticeCounts = async (ctx: Ctx): Promise<{ active: number }> => {
  const { statuses } = await noticeLookups();
  return { active: await prisma.notice.count({ where: { society_id: ctx.societyId, ...isLive(lookupId(statuses, STATUS.PUBLISHED)) } }) };
};
