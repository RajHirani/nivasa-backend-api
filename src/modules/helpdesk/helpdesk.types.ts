import type { UploadDto } from '../uploads/uploads.types.js';

// Statuses, priorities, request types and event types go out as their lookup row: `code` (what requests send back and rules use)
// and `name` (what the screen shows). Nothing here fixes which rows exist.
export interface LookupDto {
  code: string;
  name: string;
}

export interface PhoneDto {
  countryCode: string;
  mobile: string;
}

// Raised-by and assignee carry a phone only for the committee (TICKET_VIEW_ALL): the portal's committee-only exception to the phone rule.
export interface RaisedByDto extends Partial<PhoneDto> {
  id: string;
  name: string;
  flat: string | null; // "A-101"; null for a society-level complaint
  isMe: boolean;
}

export interface AssigneeDto extends Partial<PhoneDto> {
  id: string;
  name: string;
  role?: string | null; // their committee role today; only on one complaint, not in the list
  isMe: boolean;
}

export interface TicketSummaryDto {
  id: string;
  ticketNumber: string; // HD-0012
  requestType: LookupDto;
  category: string;
  title: string;
  priority: LookupDto;
  status: LookupDto;
  createdAt: string;
  raisedBy: RaisedByDto;
  assignee: AssigneeDto | null;
}

// Someone on the timeline or a comment: the role they held when they acted, or the flat of the resident who raised it.
export interface ActorDto {
  id: string;
  name: string;
  role: string | null;
  flat: string | null;
  isMe: boolean;
}

export interface TimelineEntryDto {
  type: LookupDto; // ticket_event_type row (Raised, Assigned, Reassigned, Status changed)
  status: LookupDto; // the status after the event
  at: string;
  by: ActorDto;
  assignee: string | null; // assigned / reassigned: the name it was given to
  note: string | null;
  photos: UploadDto[];
}

export interface CommentDto {
  id: string;
  body: string;
  author: ActorDto;
  createdAt: string;
  editedAt: string | null;
  photos: UploadDto[];
  canEdit: boolean;
  canDelete: boolean;
}

export interface AllowedActionsDto {
  canCancel: boolean; // the resident who raised it, while open / acknowledged / info_needed
  canAssign: boolean;
  canComment: boolean;
  statusUpdates: (LookupDto & { id: string })[]; // what Update status may set (empty when final or not allowed)
}

export interface TicketDto extends TicketSummaryDto {
  location: string | null;
  description: string;
  photos: UploadDto[];
  timeline: TimelineEntryDto[];
  comments: CommentDto[];
  allowedActions: AllowedActionsDto;
}

export interface HelpDeskOptionsDto {
  statuses: (LookupDto & { id: string })[]; // the filter sends `id`
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}

// The committee Dashboard: how many complaints are in each status (every status of the lookup table, in its order, zero included)
// and how many were raised this month.
export interface TicketSummaryCountsDto {
  thisMonth: number;
  byStatus: { id: string; code: string; name: string; count: number }[];
}

export interface TicketListDto {
  items: TicketSummaryDto[];
  total: number;
}

export interface AssignableDto {
  id: string;
  name: string;
  role: string | null;
  isMe: boolean;
}
