import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireMembership, requirePermission } from '../../middleware/society.js';
import * as controller from './home-requests.controller.js';

// Reviewing the active society's home requests (X-Society-Id).
export const homeRequestsRouter = Router();

homeRequestsRouter.use(authenticate, requireMembership);
homeRequestsRouter.get('/', requirePermission('HOME_REQUEST_VIEW'), controller.list);
// Fixed path before /:requestId.
homeRequestsRouter.get('/counts', requirePermission('HOME_REQUEST_VIEW'), controller.counts);
homeRequestsRouter.get('/:requestId', requirePermission('HOME_REQUEST_VIEW'), controller.get);
homeRequestsRouter.post('/:requestId/approve', requirePermission('HOME_REQUEST_REVIEW'), controller.approve);
homeRequestsRouter.post('/:requestId/reject', requirePermission('HOME_REQUEST_REVIEW'), controller.reject);
