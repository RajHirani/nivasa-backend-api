import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Today as a DATE (UTC day), the value of start_date / end_date for "today". */
export const today = (): Date => new Date(new Date().toISOString().slice(0, 10));

// "2026-28": the current year and the year after next, like the portal's default.
const defaultTermName = (d: Date): string => `${d.getUTCFullYear()}-${String((d.getUTCFullYear() + 1) % 100).padStart(2, '0')}`;

/**
 * The society's current committee term (closed_at NULL). The first committee role of a society creates it, named from the
 * current year and starting today; a society with no committee role has none (DATABASE-DESIGN.md 4.9).
 */
export const ensureCurrentTerm = async (tx: Tx, societyId: bigint, createdBy: bigint | null): Promise<{ id: bigint; name: string }> => {
  const find = () => tx.committee_term.findFirst({ where: { society_id: societyId, closed_at: null }, select: { id: true, name: true } });
  const existing = await find();
  if (existing) return existing;

  const base = defaultTermName(today());
  let name = base;
  for (let n = 2; await tx.committee_term.findFirst({ where: { society_id: societyId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } }); n++) {
    name = `${base} (${n})`; // an archived term already has this name
  }
  return tx.committee_term.create({ data: { society_id: societyId, name, start_date: today(), created_by: createdBy }, select: { id: true, name: true } });
};
