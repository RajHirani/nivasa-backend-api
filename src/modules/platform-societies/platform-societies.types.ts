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
