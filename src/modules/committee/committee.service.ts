import { Prisma } from '@prisma/client';
import { dayString } from '../../utils/date.js';
import { buildingDto, flatDto, unitInclude } from '../../lib/dto.js';
import { ensureCurrentTerm, today } from '../../lib/committee-term.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError, type ErrorCode } from '../../utils/api-error.js';
import { toE164 } from '../../utils/phone.js';
import type { AddMemberInput, ArchiveTermInput } from './committee.schema.js';
import type { MemberDto, MemberLookupDto, PersonDto, TermDto } from './committee.types.js';

const fieldError = (status: number, code: ErrorCode, field: string, message: string) => new ApiError(status, code, message, [{ field, message }]);
const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);

// LIKE wildcards in what a person typed are plain characters.
const likeSafe = (s: string) => s.replace(/[\\%_]/g, '\\$&');

const personSelect = {
  id: true,
  full_name: true,
  phone: true,
  email: true,
  country: { select: { dial_code: true } },
} satisfies Prisma.app_userSelect;
type PersonRow = Prisma.app_userGetPayload<{ select: typeof personSelect }>;

const roleSelect = { id: true, code: true, name: true, sort_order: true } satisfies Prisma.roleSelect;

// ---------------------------------------------------------------- people

// Flats (current homes in this society, comma separated, owner's first) and owner/tenant of the people given.
const homesOf = async (societyId: bigint, userIds: bigint[]) => {
  const rows = userIds.length
    ? await prisma.user_resident_map.findMany({
        where: { society_id: societyId, user_id: { in: userIds }, move_out_date: null, is_active: true },
        orderBy: [{ resident_role_id: 'asc' }, { id: 'asc' }],
        select: {
          user_id: true,
          structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
          resident_role: { select: { code: true } },
        },
      })
    : [];
  const map = new Map<bigint, { flats: string[]; tenure: 'Owner' | 'Tenant' }>();
  for (const r of rows) {
    const building = buildingDto(r.structure);
    const flat = building ? `${building.name}-${flatDto(r.structure).code}` : flatDto(r.structure).code;
    const entry = map.get(r.user_id);
    if (entry) entry.flats.push(flat);
    else map.set(r.user_id, { flats: [flat], tenure: r.resident_role.code === 'OWNER' ? 'Owner' : 'Tenant' });
  }
  return map;
};

const toPerson = (u: PersonRow, homes: Awaited<ReturnType<typeof homesOf>>): PersonDto => {
  const home = homes.get(u.id);
  const dial = u.country.dial_code;
  return {
    id: u.id.toString(),
    name: u.full_name,
    countryCode: dial,
    mobile: u.phone.slice(dial.length),
    email: u.email,
    flat: home ? home.flats.join(', ') : null,
    tenure: home?.tenure ?? null,
  };
};

// ---------------------------------------------------------------- terms

export const listTerms = async (societyId: bigint): Promise<TermDto[]> => {
  const [terms, rows] = await Promise.all([
    prisma.committee_term.findMany({ where: { society_id: societyId }, orderBy: [{ start_date: 'desc' }, { id: 'desc' }] }),
    prisma.user_society_role.findMany({ where: { society_id: societyId, term_id: { not: null } }, select: { term_id: true, user_id: true, end_date: true } }),
  ]);
  return terms.map((t) => {
    const own = rows.filter((r) => r.term_id === t.id);
    // The current term counts who holds a role now; a closed one everyone who served in it.
    const people = new Set((t.closed_at === null ? own.filter((r) => r.end_date === null) : own).map((r) => r.user_id));
    return {
      id: t.id.toString(),
      name: t.name,
      startDate: dayString(t.start_date),
      endDate: t.end_date ? dayString(t.end_date) : null,
      closedAt: t.closed_at ? t.closed_at.toISOString() : null,
      memberCount: people.size,
    };
  });
};

// ---------------------------------------------------------------- members

/** Current term: who holds a role now. A closed term: everyone who served in it, with the last role they held there. */
export const listMembers = async (societyId: bigint, termId?: string): Promise<MemberDto[]> => {
  const term = await prisma.committee_term.findFirst({
    where: { society_id: societyId, ...(termId ? { id: BigInt(termId) } : { closed_at: null }) },
    select: { id: true, closed_at: true },
  });
  if (!term) {
    if (termId) throw notFound('Term');
    return []; // no committee role yet, so no term
  }
  const rows = await prisma.user_society_role.findMany({
    where: { society_id: societyId, term_id: term.id, ...(term.closed_at === null ? { end_date: null } : {}) },
    orderBy: [{ start_date: 'asc' }, { id: 'asc' }],
    select: { id: true, user_id: true, start_date: true, end_date: true, role: { select: roleSelect }, app_user_user_society_role_user_idToapp_user: { select: personSelect } },
  });
  // Several rows of one person in a closed term are role changes: show the last one.
  const last = new Map<bigint, (typeof rows)[number]>();
  for (const r of rows) last.set(r.user_id, r);
  const chosen = [...last.values()];
  const homes = await homesOf(societyId, chosen.map((r) => r.user_id));
  return chosen
    .map((r) => ({
      assignmentId: r.id.toString(),
      person: toPerson(r.app_user_user_society_role_user_idToapp_user, homes),
      roleId: r.role.id.toString(),
      role: r.role.code,
      roleName: r.role.name,
      startDate: dayString(r.start_date),
      endDate: r.end_date ? dayString(r.end_date) : null,
      sort: r.role.sort_order,
    }))
    .sort((a, b) => a.sort - b.sort || a.startDate.localeCompare(b.startDate))
    .map(({ sort: _sort, ...m }) => m);
};

/** Residents of the society matching the typed name or phone digits, who do not hold a committee role now. */
export const searchResidents = async (societyId: bigint, q: string): Promise<PersonDto[]> => {
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const users = await prisma.app_user.findMany({
    where: {
      is_active: true,
      user_resident_map: { some: { society_id: societyId, move_out_date: null, is_active: true } },
      user_society_role_user_society_role_user_idToapp_user: { none: { society_id: societyId, end_date: null, is_active: true, term_id: { not: null } } },
      OR: [{ full_name: { contains: likeSafe(q), mode: 'insensitive' } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])],
    },
    orderBy: { full_name: 'asc' },
    take: 5,
    select: personSelect,
  });
  const homes = await homesOf(societyId, users.map((u) => u.id));
  return users.map((u) => toPerson(u, homes));
};

// ---------------------------------------------------------------- writes

// A role the committee screen may hand out: a built-in or the society's own society-scope role (never RESIDENT or platform roles).
const assignableRole = async (societyId: bigint, roleId: number) => {
  const role = await prisma.role.findFirst({
    where: { id: roleId, is_active: true, is_assignable: true, role_scope: { code: 'SOCIETY' }, OR: [{ society_id: null }, { society_id: societyId }] },
    select: { id: true },
  });
  if (!role) throw fieldError(400, 'VALIDATION_FAILED', 'roleId', 'Choose a role');
  return role;
};

// Step before adding someone from outside the society: is there an account for this number (and is it a resident here)?
export const lookupMember = async (societyId: bigint, input: { countryCode: string; mobile: string }): Promise<MemberLookupDto> => {
  const user = await prisma.app_user.findUnique({ where: { phone: toE164(input.countryCode, input.mobile) }, select: { id: true, full_name: true, is_active: true } });
  if (!user) return { existingAccount: false, userId: null, name: null, resident: false };
  if (!user.is_active) throw fieldError(400, 'VALIDATION_FAILED', 'mobile', 'This account is disabled');
  const home = await prisma.user_resident_map.findFirst({ where: { user_id: user.id, society_id: societyId, move_out_date: null, is_active: true }, select: { id: true } });
  return { existingAccount: true, userId: user.id.toString(), name: user.full_name, resident: home !== null };
};

const requireActiveMembership = async (tx: Prisma.TransactionClient, userId: bigint, societyId: bigint) => {
  const membership = await tx.user_society_map.findFirst({ where: { user_id: userId, society_id: societyId, left_at: null }, select: { member_status: { select: { code: true } } } });
  if (membership && membership.member_status.code !== 'ACTIVE') {
    throw new ApiError(409, 'MEMBERSHIP_INACTIVE', 'This person is not an active member of the society');
  }
  return membership !== null;
};

const alreadyOnCommittee = () => new ApiError(409, 'ALREADY_ON_COMMITTEE', 'This person is already on the committee. Use Change role instead.');

export const addMember = async (societyId: bigint, actorId: bigint, input: AddMemberInput): Promise<MemberDto> => {
  const role = await assignableRole(societyId, Number(input.roleId));

  const created = await prisma.$transaction(async (tx) => {
    let userId: bigint;
    if (input.kind === 'resident') {
      userId = BigInt(input.userId);
      const home = await tx.user_resident_map.findFirst({ where: { user_id: userId, society_id: societyId, move_out_date: null, is_active: true }, select: { id: true } });
      if (!home) throw fieldError(400, 'VALIDATION_FAILED', 'userId', 'This person is not a resident of the society');
    } else {
      const country = await tx.country.findFirst({ where: { dial_code: input.countryCode, is_active: true }, select: { id: true } });
      if (!country) throw fieldError(400, 'VALIDATION_FAILED', 'countryCode', 'This country is not supported yet');
      const phone = toE164(input.countryCode, input.mobile);
      const existing = await tx.app_user.findUnique({ where: { phone }, select: { id: true, full_name: true, is_active: true } });
      if (existing && !existing.is_active) throw fieldError(400, 'VALIDATION_FAILED', 'mobile', 'This account is disabled');
      if (existing) {
        const home = await tx.user_resident_map.findFirst({ where: { user_id: existing.id, society_id: societyId, move_out_date: null, is_active: true }, select: { id: true } });
        if (home) {
          throw fieldError(409, 'PHONE_BELONGS_TO_RESIDENT', 'mobile', `This number belongs to a resident (${existing.full_name}). Pick them from the Resident tab.`);
        }
        // An existing account is reused and takes the name typed here, like the first admin in the console.
        if (existing.full_name !== input.name) {
          await tx.app_user.update({ where: { id: existing.id }, data: { full_name: input.name, updated_at: new Date() } });
        }
        userId = existing.id;
      } else {
        // An invited account: the person signs in with this number and accepts the terms on first use.
        userId = (await tx.app_user.create({ data: { full_name: input.name, phone, country_id: country.id }, select: { id: true } })).id;
      }
    }

    if (!(await requireActiveMembership(tx, userId, societyId))) {
      const active = await tx.member_status.findFirstOrThrow({ where: { code: 'ACTIVE' }, select: { id: true } });
      await tx.user_society_map.create({ data: { user_id: userId, society_id: societyId, member_status_id: active.id, added_by: actorId } });
    }

    const term = await ensureCurrentTerm(tx, societyId, actorId);
    const current = await tx.user_society_role.findFirst({ where: { society_id: societyId, user_id: userId, term_id: term.id, end_date: null, is_active: true }, select: { id: true } });
    if (current) throw alreadyOnCommittee();
    return tx.user_society_role.create({ data: { user_id: userId, role_id: role.id, society_id: societyId, term_id: term.id, granted_by: actorId }, select: { id: true } });
  });

  const members = await listMembers(societyId);
  const added = members.find((m) => m.assignmentId === created.id.toString());
  if (!added) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return added;
};

// A current committee row of this society, in the current term.
const currentAssignment = async (tx: Prisma.TransactionClient, societyId: bigint, assignmentId: bigint) => {
  const row = await tx.user_society_role.findFirst({
    where: { id: assignmentId, society_id: societyId, end_date: null, is_active: true, committee_term: { closed_at: null } },
    select: { id: true, user_id: true, role_id: true, term_id: true, role: { select: { code: true } } },
  });
  if (!row || row.term_id === null) throw new ApiError(404, 'NOT_FOUND', 'This member is no longer on the committee');
  return { ...row, term_id: row.term_id };
};

// A society needs a Chairman: the last current PRESIDENT of the term can neither be changed nor removed.
const guardLastPresident = async (tx: Prisma.TransactionClient, societyId: bigint, row: { term_id: bigint; role: { code: string } }) => {
  if (row.role.code !== 'PRESIDENT') return;
  const chairs = await tx.user_society_role.count({ where: { society_id: societyId, term_id: row.term_id, end_date: null, is_active: true, role: { code: 'PRESIDENT' } } });
  if (chairs <= 1) throw new ApiError(409, 'LAST_PRESIDENT', 'A society needs a Chairman. Add another Chairman first, then change or remove this one.');
};

const endRow = async (tx: Prisma.TransactionClient, id: bigint, actorId: bigint) => {
  const ended = await tx.user_society_role.updateMany({
    where: { id, end_date: null },
    data: { end_date: today(), ended_by: actorId, updated_at: new Date() },
  });
  if (ended.count === 0) throw new ApiError(404, 'NOT_FOUND', 'This member is no longer on the committee'); // someone else just changed them
};

export const changeRole = async (societyId: bigint, actorId: bigint, assignmentId: bigint, roleId: number): Promise<void> => {
  const role = await assignableRole(societyId, roleId);
  await prisma.$transaction(async (tx) => {
    const row = await currentAssignment(tx, societyId, assignmentId);
    if (row.role_id === role.id) throw fieldError(400, 'VALIDATION_FAILED', 'roleId', 'Pick a different role');
    await guardLastPresident(tx, societyId, row);
    await endRow(tx, row.id, actorId);
    await tx.user_society_role.create({ data: { user_id: row.user_id, role_id: role.id, society_id: societyId, term_id: row.term_id, granted_by: actorId } });
  });
};

export const removeMember = async (societyId: bigint, actorId: bigint, assignmentId: bigint): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const row = await currentAssignment(tx, societyId, assignmentId);
    await guardLastPresident(tx, societyId, row);
    await endRow(tx, row.id, actorId);

    // Leaving the committee also ends the society membership, unless the person lives here or still holds another role.
    const home = await tx.user_resident_map.findFirst({ where: { user_id: row.user_id, society_id: societyId, move_out_date: null, is_active: true }, select: { id: true } });
    const otherRole = await tx.user_society_role.findFirst({ where: { user_id: row.user_id, society_id: societyId, end_date: null, is_active: true }, select: { id: true } });
    if (!home && !otherRole) {
      const now = new Date();
      await tx.user_society_map.updateMany({ where: { user_id: row.user_id, society_id: societyId, left_at: null }, data: { left_at: now, updated_at: now } });
    }
  });
};

// Only the name of the current term can be changed (a closed term is history).
export const renameTerm = async (societyId: bigint, actorId: bigint, termId: bigint, name: string): Promise<TermDto> => {
  try {
    await prisma.$transaction(async (tx) => {
      const term = await tx.committee_term.findFirst({ where: { id: termId, society_id: societyId }, select: { closed_at: true } });
      if (!term) throw notFound('Term');
      if (term.closed_at) throw new ApiError(409, 'TERM_NOT_CURRENT', 'Only the current term can be renamed');
      const clash = await tx.committee_term.findFirst({ where: { society_id: societyId, id: { not: termId }, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
      if (clash) throw fieldError(409, 'TERM_NAME_TAKEN', 'name', 'A term with this name already exists');
      await tx.committee_term.update({ where: { id: termId }, data: { name, updated_at: new Date() } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw fieldError(409, 'TERM_NAME_TAKEN', 'name', 'A term with this name already exists');
    }
    throw e;
  }
  const renamed = (await listTerms(societyId)).find((t) => t.id === termId.toString());
  if (!renamed) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
  return renamed;
};

// One transaction: close the current term (if any), end every current row of it, start the new term and carry the chosen members over.
export const archiveTerm = async (societyId: bigint, actorId: bigint, input: ArchiveTermInput): Promise<TermDto> => {
  try {
    const termId = await prisma.$transaction(async (tx) => {
      const clash = await tx.committee_term.findFirst({ where: { society_id: societyId, name: { equals: input.name, mode: 'insensitive' } }, select: { id: true } });
      if (clash) throw fieldError(409, 'TERM_NAME_TAKEN', 'name', 'A term with this name already exists');

      const old = await tx.committee_term.findFirst({ where: { society_id: societyId, closed_at: null }, select: { id: true } });
      const current = old
        ? await tx.user_society_role.findMany({ where: { society_id: societyId, term_id: old.id, end_date: null, is_active: true }, select: { id: true, user_id: true, role_id: true } })
        : [];
      const carry = new Set(input.carryOver);
      if (carry.size > 0 && current.filter((r) => carry.has(r.id.toString())).length !== carry.size) {
        throw fieldError(400, 'VALIDATION_FAILED', 'carryOver', 'Some members to carry over are no longer on the committee');
      }

      const now = new Date();
      if (old) {
        await tx.committee_term.update({ where: { id: old.id }, data: { closed_at: now, closed_by: actorId, end_date: today(), updated_at: now } });
        await tx.user_society_role.updateMany({ where: { id: { in: current.map((r) => r.id) } }, data: { end_date: today(), ended_by: actorId, updated_at: now } });
      }
      const fresh = await tx.committee_term.create({
        data: { society_id: societyId, name: input.name, start_date: new Date(input.startDate), end_date: input.endDate ? new Date(input.endDate) : null, created_by: actorId },
        select: { id: true },
      });
      for (const r of current.filter((x) => carry.has(x.id.toString()))) {
        await tx.user_society_role.create({
          data: { user_id: r.user_id, role_id: r.role_id, society_id: societyId, term_id: fresh.id, start_date: new Date(input.startDate), granted_by: actorId },
        });
      }
      return fresh.id;
    });
    const created = (await listTerms(societyId)).find((t) => t.id === termId.toString());
    if (!created) throw new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
    return created;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw fieldError(409, 'TERM_NAME_TAKEN', 'name', 'A term with this name already exists');
    }
    throw e;
  }
};
