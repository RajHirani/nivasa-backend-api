import type { RequestHandler } from 'express';
import { prisma } from '../../lib/prisma.js';
import { StorageNotFoundError, storage } from '../../lib/storage/index.js';
import { verifyFileUrl } from '../../lib/storage/signing.js';
import { ApiError } from '../../utils/api-error.js';
import { fileKeySchema, fileQuerySchema, uploadBodySchema, uploadIdSchema } from './uploads.schema.js';
import * as uploadsService from './uploads.service.js';

export const upload: RequestHandler = async (req, res) => {
  const { purpose } = uploadBodySchema.parse(req.body);
  if (!req.file) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'file', message: 'Choose a file to upload' }]);
  }
  res.status(201).json(await uploadsService.createUpload(req.auth!.userId, purpose, req.file));
};

export const remove: RequestHandler = async (req, res) => {
  const { uploadId } = uploadIdSchema.parse(req.params);
  await uploadsService.deleteUpload(req.auth!.userId, BigInt(uploadId));
  res.status(204).end();
};

// Signed link target (local storage driver). No Authorization header: the signature is the credential.
export const download: RequestHandler = async (req, res) => {
  // Express 5 hands wildcard segments over as an array.
  const rawKey = req.params.key;
  const key = fileKeySchema.safeParse(Array.isArray(rawKey) ? rawKey.join('/') : rawKey);
  const query = fileQuerySchema.safeParse(req.query);
  if (!key.success || !query.success || !verifyFileUrl(key.data, query.data.expires, query.data.name, query.data.sig)) {
    throw new ApiError(403, 'FORBIDDEN', 'This link is invalid or has expired');
  }
  const row = await prisma.upload.findUnique({ where: { storage_key: key.data }, select: { content_type: true } });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'File not found');

  let stream;
  try {
    stream = await storage.read(key.data);
  } catch (e) {
    if (e instanceof StorageNotFoundError) throw new ApiError(404, 'NOT_FOUND', 'File not found');
    throw e;
  }
  const asciiName = query.data.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.setHeader('Content-Type', row.content_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader(
    'Content-Disposition',
    `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(query.data.name)}`,
  );
  stream.on('error', () => res.destroy());
  stream.pipe(res);
};
