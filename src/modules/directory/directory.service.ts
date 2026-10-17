import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { flatDto, unitInclude } from '../../lib/dto.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';
import { listProviders, type Caller } from '../service-providers/service-providers.service.js';
import type { BlockDto, BlockSummaryDto, ContactDto, DirectoryContactDto } from './directory.types.js';

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// ── Resident Directory ──────────────────────────────────────────────────────────────────────────────────

// Blocks (wings / sections) with the number of people the directory lists in them.
export const listBlocks = async (societyId: bigint): Promise<BlockSummaryDto[]> => {
  const [blocks, counts] = await Promise.all([
    prisma.structure.findMany({
      where: { society_id: societyId, is_active: true, structure_type: { is_building: true } },
      orderBy: [{ sort_order: 'asc' }, { identifier: 'asc' }],
      select: { id: true, identifier: true },
    }),
    prisma.$queryRaw<{ building_id: bigint; n: number }[]>`
      SELECT u.building_id AS building_id, COUNT(DISTINCT m.user_id)::int AS n
      FROM user_resident_map m
      JOIN structure u ON u.id = m.unit_id AND u.is_active
      JOIN occupancy_status o ON o.id = m.occupancy_status_id
      WHERE m.society_id = ${societyId}
        AND m.move_out_date IS NULL
        AND m.is_active
        AND o.code IN (${Prisma.join(env.directory.occupancyCodes)})
      GROUP BY u.building_id`,
  ]);
  const countOf = new Map(counts.map((c) => [c.building_id, c.n]));
  return blocks
    .sort((a, b) => natural(a.identifier, b.identifier))
    .map((b) => ({ id: b.id.toString(), name: `${b.identifier} Block`, memberCount: countOf.get(b.id) ?? 0 }));
};

// Flats of a block with their residents. A flat appears when someone the directory lists lives there, and the caller's
// own homes always appear (with the caller marked `isMe`). No phone numbers.
export const getBlock = async (societyId: bigint, userId: bigint, blockId: bigint): Promise<BlockDto> => {
  const block = await prisma.structure.findFirst({
    where: { id: blockId, society_id: societyId, is_active: true, structure_type: { is_building: true } },
    select: { id: true, identifier: true },
  });
  if (!block) throw new ApiError(404, 'NOT_FOUND', 'Block not found');

  const rows = await prisma.user_resident_map.findMany({
    where: {
      society_id: societyId,
      move_out_date: null,
      is_active: true,
      structure: { building_id: blockId, is_active: true },
      OR: [{ occupancy_status: { code: { in: env.directory.occupancyCodes } } }, { user_id: userId }],
    },
    select: {
      id: true,
      user_id: true,
      resident_relation: { select: { label: true, sort_order: true } },
      app_user: { select: { full_name: true } },
      structure: { select: { id: true, identifier: true, floor_number: true, ...unitInclude } },
    },
  });

  const flats = new Map<bigint, { id: string; code: string; floor: number; residents: (BlockDto['flats'][number]['residents'][number] & { order: number })[] }>();
  for (const r of rows) {
    const flat = flats.get(r.structure.id) ?? (() => {
      const f = flatDto(r.structure);
      const entry = { id: f.id, code: f.code, floor: f.floor ?? 0, residents: [] };
      flats.set(r.structure.id, entry);
      return entry;
    })();
    flat.residents.push({
      id: r.id.toString(),
      name: r.app_user.full_name,
      role: r.resident_relation.label,
      order: r.resident_relation.sort_order,
      isMe: r.user_id === userId,
    });
  }

  const result = [...flats.values()].sort((a, b) => a.floor - b.floor || natural(a.code, b.code));
  for (const f of result) f.residents.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return {
    id: block.id.toString(),
    name: block.identifier,
    flats: result.map((f) => ({ ...f, residents: f.residents.map(({ order: _order, ...resident }) => resident) })),
  };
};

// ── Contacts ────────────────────────────────────────────────────────────────────────────────────────────

// People who currently hold one of the roles in the society (active members only), one row per role held.
const roleHolders = async (societyId: bigint, roleCodes: string[]) => {
  const [assignments, blocked] = await Promise.all([
    prisma.user_society_role.findMany({
      where: {
        society_id: societyId,
        is_active: true,
        end_date: null,
        role: { code: { in: roleCodes }, is_active: true },
        app_user_user_society_role_user_idToapp_user: { is_active: true },
      },
      select: {
        id: true,
        user_id: true,
        role: { select: { name: true, sort_order: true } },
        app_user_user_society_role_user_idToapp_user: { select: { full_name: true, phone: true, country: { select: { dial_code: true } } } },
      },
    }),
    prisma.user_society_map.findMany({
      where: { society_id: societyId, left_at: null, member_status: { code: 'INACTIVE' } },
      select: { user_id: true },
    }),
  ]);
  const inactive = new Set(blocked.map((b) => b.user_id));
  return assignments
    .filter((a) => !inactive.has(a.user_id))
    .map((a) => ({
      userId: a.user_id.toString(),
      societyContactId: null,
      name: a.app_user_user_society_role_user_idToapp_user.full_name,
      phone: a.app_user_user_society_role_user_idToapp_user.phone,
      countryCode: a.app_user_user_society_role_user_idToapp_user.country.dial_code,
      label: a.role.name,
      order: a.role.sort_order,
    }))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
};

const societyContacts = async (societyId: bigint, categoryCode: string): Promise<ContactDto[]> => {
  const rows = await prisma.society_contact.findMany({
    where: { society_id: societyId, is_active: true, contact_category: { code: categoryCode } },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, title: true, phone: true, country: { select: { dial_code: true } } },
  });
  return rows.map((r) => ({ userId: null, societyContactId: r.id.toString(), name: r.name, phone: r.phone, countryCode: r.country.dial_code, label: r.title, editable: true }));
};

export const listContacts = async (caller: Caller, type: 'COMMITTEE' | 'SERVICE' | 'EMERGENCY' | 'GUARDS'): Promise<DirectoryContactDto[]> => {
  switch (type) {
    case 'COMMITTEE':
      return (await roleHolders(caller.societyId, env.directory.committeeRoleCodes)).map(({ order: _order, ...c }) => ({ ...c, editable: false }));
    case 'EMERGENCY':
      return societyContacts(caller.societyId, 'EMERGENCY');
    case 'SERVICE':
      return listProviders(caller);
    case 'GUARDS': {
      // Guards with the app (role holders) come first; a guard contact with the same phone is not listed twice.
      const [holders, contacts] = await Promise.all([
        roleHolders(caller.societyId, env.directory.guardRoleCodes),
        societyContacts(caller.societyId, 'GUARD'),
      ]);
      const known = new Set(holders.map((h) => h.phone));
      return [...holders.map(({ order: _order, ...c }) => ({ ...c, editable: false })), ...contacts.filter((c) => !known.has(c.phone))];
    }
  }
};
