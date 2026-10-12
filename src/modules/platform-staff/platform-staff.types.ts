export type StaffRoleCode = 'PLATFORM_ADMIN' | 'PLATFORM_ONBOARDING' | 'PLATFORM_SUPPORT';
export type StaffStatus = 'INVITED' | 'ACTIVE' | 'DEACTIVATED';

export interface StaffRoleDto {
  code: StaffRoleCode;
  name: string;
  description: string;
}

export interface StaffMemberDto {
  id: string;
  name: string;
  email: string;
  countryCode: string;
  mobile: string;
  role: { code: StaffRoleCode; name: string };
  status: StaffStatus;
  lastActiveAt: string | null;
  invitedBy: string | null;
  invitedAt: string;
}

export interface StaffPageDto {
  items: StaffMemberDto[];
  total: number;
  page: number;
  pageSize: number;
}
