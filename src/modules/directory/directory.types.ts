import type { ServiceProviderDto } from '../service-providers/service-providers.types.js';

// Committee, guards and emergency rows. A row is either a Nivas user who holds a role (`userId`, `societyContactId` null) or
// a society contact (`societyContactId`, `userId` null). `phone` is E.164 and `countryCode` the dial code it starts with;
// `label` is the role, gate or what the contact is (optional). `editable` is false for people listed through a role (they
// are managed with their role, not as a contact).
export interface ContactDto {
  userId: string | null;
  societyContactId: string | null;
  name: string;
  phone: string;
  countryCode: string;
  label: string | null;
  editable: boolean;
}

export type DirectoryContactDto = ContactDto | ServiceProviderDto;

export interface BlockSummaryDto {
  id: string;
  name: string;
  memberCount: number;
}

export interface ResidentDto {
  id: string;
  name: string;
  role: string; // resident_relation.label, e.g. "Owner", "Family member"
  isMe: boolean;
}

export interface DirectoryFlatDto {
  id: string;
  code: string;
  floor: number;
  residents: ResidentDto[];
}

export interface BlockDto {
  id: string;
  name: string;
  flats: DirectoryFlatDto[];
}

// The committee portal's Residents tab: one row per current home (a person in two homes is two rows). Phones are shown to
// the committee only (COMMITTEE_VIEW), never in the resident-facing directory.
export interface ResidentRowDto {
  id: string;
  name: string;
  relation: string; // resident_relation.label
  block: string;
  flat: string; // "A-105"
  occupancy: { id: string; code: string; name: string };
  countryCode: string;
  mobile: string;
}

export interface DirectorySummaryDto {
  residents: number;
  committee: number;
  services: number;
  emergency: number;
  guards: number;
}

export interface OccupancyStatusDto {
  id: string;
  code: string;
  name: string;
}
