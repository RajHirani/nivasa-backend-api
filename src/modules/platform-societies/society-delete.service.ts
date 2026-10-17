import { prisma } from '../../lib/prisma.js';
import { storage } from '../../lib/storage/index.js';
import { ApiError } from '../../utils/api-error.js';

// Deletes a society and everything that belongs to it, for good (Super Admin only, the typed name confirms it).
// Everything is wiped in ONE transaction, children before parents: its reviews and households of service providers, the providers and
// service types, the residents and home requests (with their documents), the whole structure, society roles, memberships and role
// assignments, contacts, module switches, the activity log, the society itself and its logo.
//
// People are never deleted: an account (app_user) is one person across every society, so only this society's links to people go
// (memberships, role assignments, residents, home requests). Uploaded files are removed from storage after the commit (a missing file is not an error).

const ids = (rows: { id: bigint }[]) => rows.map((r) => r.id);

export const deleteSociety = async (societyId: bigint, actorId: bigint, confirmName: string): Promise<void> => {
  const society = await prisma.society.findUnique({ where: { id: societyId }, select: { name: true } });
  if (!society) throw new ApiError(404, 'NOT_FOUND', 'Society not found');
  if (confirmName.trim() !== society.name) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'The name does not match', [{ field: 'name', message: 'Type the society name exactly to confirm' }]);
  }

  let storageKeys: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      // The files to remove from storage afterwards.
      const uploads = await tx.$queryRaw<{ id: bigint; storage_key: string }[]>`
        SELECT u.id, u.storage_key FROM upload u
        WHERE u.id = (SELECT logo_upload_id FROM society WHERE id = ${societyId})
           OR u.id IN (SELECT d.upload_id FROM home_request_document d JOIN home_request h ON h.id = d.home_request_id WHERE h.society_id = ${societyId})`;
      storageKeys = uploads.map((u) => u.storage_key);

      // Service directory: reviews and households point at both the provider and the unit.
      await tx.$executeRaw`DELETE FROM service_provider_review WHERE service_provider_id IN (SELECT id FROM service_provider WHERE society_id = ${societyId})
        OR unit_id IN (SELECT id FROM structure WHERE society_id = ${societyId})`;
      await tx.$executeRaw`DELETE FROM service_provider_household WHERE service_provider_id IN (SELECT id FROM service_provider WHERE society_id = ${societyId})
        OR unit_id IN (SELECT id FROM structure WHERE society_id = ${societyId})`;
      await tx.$executeRaw`DELETE FROM service_provider WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM service_type WHERE society_id = ${societyId}`;
      // Homes: residents refer to their request, requests to their documents and units.
      await tx.$executeRaw`DELETE FROM user_resident_map WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM home_request_document WHERE home_request_id IN (SELECT id FROM home_request WHERE society_id = ${societyId})`;
      await tx.$executeRaw`DELETE FROM home_request WHERE society_id = ${societyId}`;
      // The structure refers to itself (parent, building, floor); one statement removes all of it.
      await tx.$executeRaw`DELETE FROM structure WHERE society_id = ${societyId}`;
      // Roles of the society: assignments and memberships first, then its own roles with their permissions.
      await tx.$executeRaw`DELETE FROM user_society_role WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM committee_term WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM user_society_map WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM role_permission WHERE role_id IN (SELECT id FROM role WHERE society_id = ${societyId})`;
      await tx.$executeRaw`DELETE FROM role WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM society_contact WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM society_module WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM society_activity WHERE society_id = ${societyId}`;
      await tx.$executeRaw`DELETE FROM society WHERE id = ${societyId}`;
      if (uploads.length > 0) await tx.$executeRaw`DELETE FROM upload WHERE id = ANY(${ids(uploads)}::bigint[])`;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  await Promise.all(storageKeys.map((key) => storage.delete(key).catch((err) => console.error(`[society] could not delete file ${key}`, err))));
  // The society's own activity log went with it, so this line is the record.
  console.warn(`[society] "${society.name}" (id ${societyId}) was deleted for good by staff user ${actorId}`);
};
