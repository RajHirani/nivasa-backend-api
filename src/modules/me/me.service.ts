import { prisma } from '../../lib/prisma.js';
import { loadAccess } from '../../lib/access.js';
import { ApiError } from '../../utils/api-error.js';
import { buildingDto, cityDto, countryDto, flatDto, lower, societyDto, unitInclude } from '../../lib/dto.js';
import type {
  EntryDto,
  HomeRequestSummaryDto,
  MeDto,
  MemberHomeDto,
  MembershipDto,
  UserDto,
} from './me.types.js';

const MEMBER_ACTIVE = 'ACTIVE';
const REQUEST_PENDING = 'PENDING';
const REQUEST_REJECTED = 'REJECTED';

// Split an E.164 number into the dial code of a known country and the national number.
const splitPhone = async (phone: string): Promise<{ countryCode: string; mobile: string }> => {
  const countries = await prisma.country.findMany({ select: { dial_code: true } });
  const match = countries
    .map((c) => c.dial_code)
    .filter((d) => phone.startsWith(d))
    .sort((a, b) => b.length - a.length)[0];
  return match ? { countryCode: match, mobile: phone.slice(match.length) } : { countryCode: '', mobile: phone };
};

// Active, current memberships (oldest first) with roles, permissions and current approved homes.
export const listMemberships = async (userId: bigint): Promise<MembershipDto[]> => {
  const [members, residents] = await Promise.all([
    prisma.user_society_map.findMany({
      where: { user_id: userId, left_at: null, member_status: { code: MEMBER_ACTIVE }, society: { is_active: true } },
      orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
      select: {
        society_id: true,
        joined_at: true,
        society: { include: { city: { include: { country: true } } } },
      },
    }),
    prisma.user_resident_map.findMany({
      where: { user_id: userId, move_out_date: null, is_active: true },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        society_id: true,
        home_request_id: true,
        structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
        resident_relation: { select: { code: true, name: true } },
        occupancy_status: { select: { code: true } },
      },
    }),
  ]);

  const societyIds = members.map((m) => m.society_id);
  const residentSocieties = new Set(residents.map((r) => r.society_id));
  const access = await loadAccess(userId, societyIds, residentSocieties);

  return members.map((m) => {
    const homes: MemberHomeDto[] = residents
      .filter((r) => r.society_id === m.society_id)
      .map((r) => ({
        id: r.id.toString(),
        requestId: r.home_request_id?.toString() ?? null,
        building: buildingDto(r.structure),
        flat: flatDto(r.structure),
        relation: lower(r.resident_relation.code),
        relationLabel: r.resident_relation.name,
        occupancy: lower(r.occupancy_status.code),
      }));
    const a = access.get(m.society_id) ?? { roles: [], permissions: [] };
    return {
      society: societyDto(m.society),
      city: cityDto(m.society.city),
      country: countryDto(m.society.city.country),
      roles: a.roles,
      permissions: a.permissions,
      homes,
      joinedAt: m.joined_at.toISOString(),
    };
  });
};

// Pending and rejected home requests, newest first (approved ones live on as homes, cancelled ones are gone).
export const listHomeRequests = async (userId: bigint): Promise<HomeRequestSummaryDto[]> => {
  const rows = await prisma.home_request.findMany({
    where: { user_id: userId, request_status: { code: { in: [REQUEST_PENDING, REQUEST_REJECTED] } } },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      rejection_reason: true,
      created_at: true,
      request_status: { select: { code: true } },
      resident_relation: { select: { name: true } },
      society: { include: { city: true } },
      structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
    },
  });
  return rows.map((r) => ({
    requestId: r.id.toString(),
    status: lower(r.request_status.code) as 'pending' | 'rejected',
    rejectionReason: r.rejection_reason,
    society: societyDto(r.society),
    city: cityDto(r.society.city),
    building: buildingDto(r.structure),
    flat: flatDto(r.structure),
    relationLabel: r.resident_relation.name,
    createdAt: r.created_at.toISOString(),
  }));
};

// Any active membership → home (default: the most recently joined society, and its first approved home).
// Otherwise a pending/rejected request → requestStatus, otherwise onboarding. Requests never override a membership.
export const decideEntry = (memberships: MembershipDto[], requests: HomeRequestSummaryDto[]): EntryDto => {
  const latest = memberships[memberships.length - 1];
  if (latest) {
    return { route: 'home', societyId: latest.society.id, homeId: latest.homes[0]?.id ?? null, requestId: null };
  }
  if (requests[0]) {
    return { route: 'requestStatus', societyId: null, homeId: null, requestId: requests[0].requestId };
  }
  return { route: 'onboarding', societyId: null, homeId: null, requestId: null };
};

export const getUser = async (userId: bigint): Promise<UserDto> => {
  const u = await prisma.app_user.findUnique({ where: { id: userId } });
  if (!u) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'No account found');
  return { id: u.id.toString(), ...(await splitPhone(u.phone)), name: u.full_name, email: u.email };
};

export const getMe = async (userId: bigint, knownUser?: UserDto): Promise<MeDto> => {
  const [user, memberships, homeRequests] = await Promise.all([
    knownUser ?? getUser(userId),
    listMemberships(userId),
    listHomeRequests(userId),
  ]);
  return { user, memberships, homeRequests, entry: decideEntry(memberships, homeRequests) };
};
