import { Router } from 'express';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './uploads.controller.js';
import { maxUploadBytes } from './uploads.service.js';

// One file per request, kept in memory until it is validated and handed to the storage driver.
// The size cap is the largest max_mb among the upload purposes; each purpose's own limit is checked in the service.
const multipart: RequestHandler = async (req, res, next) => {
  try {
    const fileSize = await maxUploadBytes();
    multer({ storage: multer.memoryStorage(), limits: { fileSize, files: 1, fields: 5 } }).single('file')(req, res, next);
  } catch (e) {
    next(e);
  }
};

export const uploadsRouter = Router();
uploadsRouter.post('/', authenticate, multipart, controller.upload);
uploadsRouter.delete('/:uploadId', authenticate, controller.remove);

export const filesRouter = Router();
filesRouter.get('/*key', controller.download);
