import type { UploadDto } from '../uploads/uploads.types.js';
import type { BuildingDto, FlatDto } from '../me/me.types.js';

// What a reviewer sees. The applicant's phone number is never part of it.
export interface HomeRequestDto {
  requestId: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  applicant: { id: string; name: string };
  role: string;
  relation: string;
  relationLabel: string;
  occupancy: string;
  building: BuildingDto | null;
  flat: FlatDto;
  agreementStart: string | null;
  agreementEnd: string | null;
  documents: UploadDto[];
  createdAt: string;
  decidedAt: string | null;
  reviewedBy: { id: string; name: string } | null;
}
