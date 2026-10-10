import type { BuildingDto, FlatDto } from '../me/me.types.js';

export interface ServiceTypeDto {
  id: string;
  code: string;
  name: string;
  isDailyHelp: boolean;
}

export interface UnitRefDto {
  building: BuildingDto | null;
  flat: FlatDto;
}

// A Service Directory row. `phone` is E.164. Ratings exist for daily-help types only.
export interface ServiceProviderDto {
  id: string;
  name: string;
  phone: string;
  label: string;
  serviceType: ServiceTypeDto;
  rating: { average: number; count: number } | null;
  canEdit: boolean;
  servesMyHome: boolean;
}

export interface ReviewDto {
  id: string;
  rating: number;
  comment: string | null;
  reviewer: { id: string; name: string };
  flat: FlatDto;
  isMine: boolean;
  updatedAt: string;
}

export interface ServiceProviderDetailDto extends ServiceProviderDto {
  households: UnitRefDto[];
  myReview: ReviewDto | null;
}

export interface DailyHelpDto extends ServiceProviderDto {
  myUnits: UnitRefDto[];
}
