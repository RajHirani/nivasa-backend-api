import type { RoleRef } from '../../lib/access.js';

export interface UserDto {
  id: string;
  countryCode: string;
  mobile: string;
  name: string;
  email: string | null;
}

export interface SocietyDto {
  id: string;
  name: string;
  cityId: string;
  address: string | null;
}

export interface CityDto {
  id: string;
  name: string;
  isPopular: boolean;
}

export interface CountryDto {
  id: string;
  name: string;
  isoCode: string;
}

export interface BuildingDto {
  id: string;
  name: string;
}

export interface FlatDto {
  id: string;
  code: string;
  floor: number | null;
}

export interface MemberHomeDto {
  id: string;
  requestId: string | null;
  building: BuildingDto | null;
  flat: FlatDto;
  relation: string;
  relationLabel: string;
  occupancy: string;
}

export interface MembershipDto {
  society: SocietyDto;
  city: CityDto;
  country: CountryDto;
  roles: RoleRef[];
  permissions: string[];
  homes: MemberHomeDto[];
  joinedAt: string;
}

export interface HomeRequestSummaryDto {
  requestId: string;
  status: string;
  rejectionReason: string | null;
  society: SocietyDto;
  city: CityDto;
  building: BuildingDto | null;
  flat: FlatDto;
  relationLabel: string;
  createdAt: string;
}

export interface EntryDto {
  route: 'HOME' | 'REQUEST_STATUS' | 'ONBOARDING';
  societyId: string | null;
  homeId: string | null;
  requestId: string | null;
}

export interface MeDto {
  user: UserDto;
  memberships: MembershipDto[];
  homeRequests: HomeRequestSummaryDto[];
  entry: EntryDto;
}
