export type SocietyType = 'APARTMENT' | 'TENEMENT';
export type SocietyStatus = 'ACTIVE' | 'INACTIVE';

export interface SocietySummaryDto {
  id: string;
  name: string;
  type: SocietyType;
  status: SocietyStatus;
  city: string;
  state: string;
  firstAdmin: { name: string; countryCode: string; mobile: string } | null;
  unitCount: number;
  createdAt: string;
}

export interface SocietyPageDto {
  items: SocietySummaryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardDto {
  totalSocieties: number;
  activeSocieties: number;
  inactiveSocieties: number;
  unitsManaged: number;
  recentSocieties: SocietySummaryDto[];
}

export interface SocietyAdminDto {
  userId: string;
  name: string;
  countryCode: string;
  mobile: string;
  email: string | null;
  /** INVITED until the person has signed in to the mobile app once (terms accepted). */
  status: 'INVITED' | 'ACTIVE';
  isFirstAdmin: boolean;
  since: string;
}

export interface SocietyDetailDto {
  id: string;
  name: string;
  type: SocietyType;
  status: SocietyStatus;
  registrationNumber: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  address: string;
  city: { id: string; name: string };
  state: { id: string; name: string };
  country: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string | null;
  buildingCount: number;
  unitCount: number;
  occupiedUnitCount: number;
  firstAdmin?: SocietyAdminDto;
  inactiveReason: string | null;
  createdAt: string;
}

export interface UnitDto {
  id: string;
  number: string;
  /** True if it has a current resident or a pending home request: such a unit can be renamed but never removed. */
  occupied: boolean;
}

export interface FloorDto {
  number: number;
  flats: UnitDto[];
}

export interface BuildingDto {
  id: string;
  name: string;
  unitCount: number;
  /** Apartments only. */
  floors?: FloorDto[];
  /** Tenements only. */
  houses?: UnitDto[];
}

export interface StructureDto {
  type: SocietyType;
  buildings: BuildingDto[];
}

export interface SocietyModuleDto {
  code: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface ActivityEntryDto {
  id: string;
  type: string;
  summary: string;
  note: string | null;
  /** The staff member's name; null = the system. */
  by: string | null;
  /** The staff member's platform role now (for example "Onboarding"), when they still have one. */
  byRole: string | null;
  createdAt: string;
}

export interface ActivityPageDto {
  items: ActivityEntryDto[];
  total: number;
  page: number;
  pageSize: number;
}
