import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireMembership, requirePermission } from '../../middleware/society.js';
import * as controller from './notices.controller.js';

// The notices of the active society (X-Society-Id). Everyone with NOTICE_VIEW reads the live notices meant for them (the app);
// NOTICE_POST creates, edits, pins and deletes, and lists every notice of the society, deleted ones too (the committee portal, `?page=`);
// view-only roles get the same list limited to what the app shows.
export const noticesRouter = Router();

noticesRouter.use(authenticate, requireMembership);
const reader = requireAnyPermission('NOTICE_VIEW', 'NOTICE_POST');
const poster = requirePermission('NOTICE_POST');

noticesRouter.get('/options', reader, controller.options);
noticesRouter.get('/summary', reader, controller.counts);
noticesRouter.get('/', reader, controller.list);
noticesRouter.post('/', poster, controller.create);
noticesRouter.get('/:noticeId', reader, controller.get);
noticesRouter.patch('/:noticeId', poster, controller.update);
noticesRouter.delete('/:noticeId', poster, controller.remove);
