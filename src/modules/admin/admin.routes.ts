import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './admin.controller.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requirePlatformPermission('CACHE_CLEAR'));
adminRouter.delete('/cache', controller.clearAll);
adminRouter.delete('/cache/:key', controller.clearOne);
