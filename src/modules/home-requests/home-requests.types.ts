import type { UploadDto } from '../uploads/uploads.types.js';
import type { BuildingDto, FlatDto } from '../me/me.types.js';

// What a reviewer (committee) sees: the applicant's phone and email are part of it so they can be contacted.
export interface RequestDocumentDto extends UploadDto {
  purposeLabel: string;
  uploadedAt: string;
}

export interface HomeRequestDto {
  requestId: string;
  status: string; // request_status.code: PENDING, APPROVED, REJECTED
  rejectionReason: string | null;
  applicant: { id: string; name: string; countryCode: string; mobile: string; email: string | null };
  role: string;
  relation: string;
  relationLabel: string;
  occupancy: string;
  occupancyName: string;
  building: BuildingDto | null;
  flat: FlatDto;
  agreementStart: string | null;
  agreementEnd: string | null;
  documents: RequestDocumentDto[];
  createdAt: string;
  decidedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
}

export interface HomeRequestCountsDto {
  PENDING: number;
  APPROVED: number;
  REJECTED: number;
  ALL: number;
}
