import type { Prisma } from '@prisma/client';
import { ApiError } from '../utils/api-error.js';

// Uploads are fresh files of the caller with the right purpose, claimed once (attached_at) and linked by the caller.
export const claimUploads = async (tx: Prisma.TransactionClient, userId: bigint, ids: string[], purpose: string, field = 'photoIds'): Promise<bigint[]> => {
  const wanted = [...new Set(ids)].map(BigInt);
  if (wanted.length === 0) return [];
  const own = await tx.upload.count({ where: { id: { in: wanted }, user_id: userId, upload_purpose: { code: purpose } } });
  if (own !== wanted.length) throw new ApiError(400, 'VALIDATION_FAILED', 'One of the files is not valid', [{ field, message: 'One of the files is not valid' }]);
  const claimed = await tx.upload.updateMany({ where: { id: { in: wanted }, attached_at: null }, data: { attached_at: new Date() } });
  if (claimed.count !== wanted.length) throw new ApiError(409, 'UPLOAD_IN_USE', 'One of the files is already used');
  return wanted;
};
