import type { UploadDto } from '../uploads/uploads.types.js';

export interface LookupDto {
  id: string;
  code: string;
  name: string;
}

// The list row, also the app's NoticeSummary (the extra fields are for the committee portal).
export interface NoticeSummaryDto {
  id: string;
  title: string;
  excerpt: string; // first ~160 characters of the description
  publishedAt: string;
  attachmentCount: number;
  hasImages: boolean;
  status: LookupDto; // PUBLISHED / EXPIRED (DELETED never leaves the API)
  audience: LookupDto;
  buildings: { id: string; name: string }[]; // only for the BLOCKS audience
  isPinned: boolean;
  expiresOn: string | null; // YYYY-MM-DD, the notice shows until the end of that day
  // What the caller may do (the committee's NOTICE_POST, and only on a live notice for edit); expired and deleted notices are read only.
  canEdit: boolean;
  canDelete: boolean;
}

export interface NoticeDto extends NoticeSummaryDto {
  description: string;
  banner: UploadDto | null;
  attachments: UploadDto[];
  postedBy: { name: string; role: string | null } | null;
  updatedAt: string;
}

export interface NoticeOptionsDto {
  audiences: LookupDto[];
  statuses: LookupDto[];
}

export interface NoticeListDto {
  items: NoticeSummaryDto[];
  total: number;
}

export interface NoticeCursorListDto {
  items: NoticeSummaryDto[];
  nextCursor: string | null;
}
