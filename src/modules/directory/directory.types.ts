import type { ServiceProviderDto } from '../service-providers/service-providers.types.js';

// Committee, guards and emergency rows. `phone` is E.164; `label` is the role, gate or what the contact is (optional).
export interface ContactDto {
  id: string;
  name: string;
  phone: string;
  label: string | null;
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
