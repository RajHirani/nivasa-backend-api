import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './uploads.controller.js';
import { MAX_UPLOAD_BYTES } from './uploads.service.js';

// One file per request, kept in memory (max 10 MB) until it is validated and handed to the storage driver.
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });

export const uploadsRouter = Router();
uploadsRouter.post('/', authenticate, multipart.single('file'), controller.upload);
uploadsRouter.delete('/:uploadId', authenticate, controller.remove);

export const filesRouter = Router();
filesRouter.get('/*key', controller.download);
