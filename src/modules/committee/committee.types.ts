export interface PersonDto {
  id: string;
  name: string;
  countryCode: string;
  mobile: string;
  email: string | null;
  /** Flats the person lives in, comma separated ("B-401, C-102"); null = lives outside the society. */
  flat: string | null;
  tenure: 'Owner' | 'Tenant' | null;
}

export interface MemberDto {
  assignmentId: string;
  person: PersonDto;
  roleId: string;
  role: string; // role.code
  roleName: string;
  startDate: string;
  endDate: string | null;
}

export interface TermDto {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  closedAt: string | null;
  memberCount: number;
}

export interface MemberLookupDto {
  existingAccount: boolean;
  userId: string | null;
  name: string | null;
  /** True when the number belongs to a resident of this society: they are added from the Resident tab. */
  resident: boolean;
}
