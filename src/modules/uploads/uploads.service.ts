import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { CACHE_KEYS, cached } from '../../lib/static-cache.js';
import { storage } from '../../lib/storage/index.js';
import { ApiError } from '../../utils/api-error.js';
import type { UploadDto } from './uploads.types.js';

const MB = 1024 * 1024;

// Active upload purposes with their rules, cached until an admin clears CACHE_KEYS.UPLOAD_PURPOSES.
const uploadPurposes = () =>
  cached(CACHE_KEYS.UPLOAD_PURPOSES, () =>
    prisma.upload_purpose.findMany({
      where: { is_active: true },
      select: { id: true, code: true, allowed_content_types: true, max_mb: true },
    }),
  );

// Largest file any active purpose accepts; the multipart parser stops reading at this size.
export const maxUploadBytes = async (): Promise<number> =>
  Math.max(0, ...(await uploadPurposes()).map((p) => p.max_mb)) * MB;

export const toUploadDto = async (u: {
  id: bigint;
  file_name: string;
  content_type: string;
  size_bytes: bigint;
  storage_key: string;
  upload_purpose: { code: string };
}): Promise<UploadDto> => ({
  id: u.id.toString(),
  purpose: u.upload_purpose.code,
  name: u.file_name,
  size: Number(u.size_bytes),
  contentType: u.content_type,
  url: await storage.downloadUrl(u.storage_key, {
    expiresInSeconds: env.storage.downloadUrlTtlSeconds,
    fileName: u.file_name,
  }),
});

export const createUpload = async (
  userId: bigint,
  purpose: string,
  file: { originalname: string; buffer: Buffer; size: number },
): Promise<UploadDto> => {
  const rule = (await uploadPurposes()).find((p) => p.code === purpose);
  if (!rule) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'purpose', message: 'Choose what the file is for' }]);
  }
  // e.g. "PDF, JPEG or PNG" from application/pdf, image/jpeg, image/png
  const names = rule.allowed_content_types.map((t) => (t.split('/')[1] ?? t).toUpperCase());
  const allowed = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? '');
  const unsupported = () =>
    new ApiError(415, 'UNSUPPORTED_FILE_TYPE', `Not supported · Use ${allowed}`, [
      { field: 'file', message: `Not supported · Use ${allowed}` },
    ]);

  if (file.size === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'file', message: 'The file is empty' }]);
  if (file.size > rule.max_mb * MB) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `File is too large (max ${rule.max_mb} MB)`);
  }

  // Trust the bytes, not the extension or the client's Content-Type.
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !rule.allowed_content_types.includes(detected.mime)) throw unsupported();
  const extension = detected.ext;

  const storageKey = `uploads/${userId}/${randomUUID()}.${extension}`;
  await storage.put(storageKey, file.buffer, { contentType: detected.mime });
  try {
    const row = await prisma.upload.create({
      data: {
        user_id: userId,
        upload_purpose_id: rule.id,
        file_name: file.originalname.slice(0, 255) || `file.${extension}`,
        content_type: detected.mime,
        size_bytes: BigInt(file.size),
        storage_key: storageKey,
      },
      include: { upload_purpose: { select: { code: true } } },
    });
    return await toUploadDto(row);
  } catch (e) {
    await storage.delete(storageKey); // do not leave an orphan file when the row could not be saved
    throw e;
  }
};

export const deleteUpload = async (userId: bigint, uploadId: bigint): Promise<void> => {
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
    select: { user_id: true, storage_key: true, attached_at: true, _count: { select: { home_request_document: true } } },
  });
  if (!upload || upload.user_id !== userId) throw new ApiError(404, 'NOT_FOUND', 'File not found');
  if (upload.attached_at || upload._count.home_request_document > 0) {
    throw new ApiError(409, 'UPLOAD_IN_USE', 'This file is already attached and cannot be removed');
  }
  await prisma.upload.delete({ where: { id: uploadId } });
  await storage.delete(upload.storage_key);
};

// Unattached uploads older than 24 h are removed (contract). Returns how many were deleted.
export const deleteStaleUploads = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stale = await prisma.upload.findMany({
    where: { attached_at: null, created_at: { lt: cutoff }, home_request_document: { none: {} } },
    select: { id: true, storage_key: true },
    take: 200,
  });
  let removed = 0;
  for (const u of stale) {
    try {
      await prisma.upload.delete({ where: { id: u.id } });
      await storage.delete(u.storage_key);
      removed++;
    } catch (e) {
      console.error('Could not delete stale upload', u.id, e); // e.g. attached concurrently; retried next run
    }
  }
  return removed;
};
