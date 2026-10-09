import type { UploadDto } from '../uploads/uploads.types.js';
import type { BuildingDto, CityDto, CountryDto, FlatDto, SocietyDto } from '../me/me.types.js';

export interface HomeDto {
  id: string;
  requestId: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  role: string;
  relation: string;
  relationLabel: string;
  occupancy: string;
  society: SocietyDto;
  city: CityDto;
  country: CountryDto;
  building: BuildingDto | null;
  flat: FlatDto;
  agreementStart: string | null;
  agreementEnd: string | null;
  documents: UploadDto[];
  createdAt: string;
  decidedAt: string | null;
}
