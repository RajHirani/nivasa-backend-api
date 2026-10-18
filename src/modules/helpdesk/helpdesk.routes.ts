import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireMembership, requirePermission } from '../../middleware/society.js';
import * as controller from './helpdesk.controller.js';

// The Help Desk of the active society (X-Society-Id). Residents raise and follow their own complaints (TICKET_CREATE); the
// committee (TICKET_VIEW_ALL) sees every complaint. Who may see or act on one complaint is decided in the service layer.
export const helpdeskRouter = Router();

helpdeskRouter.use(authenticate, requireMembership);
const either = requireAnyPermission('TICKET_CREATE', 'TICKET_VIEW_ALL');

helpdeskRouter.get('/options', either, controller.options);
helpdeskRouter.get('/tickets', either, controller.list);
helpdeskRouter.get('/summary', requirePermission('TICKET_VIEW_ALL'), controller.counts);
helpdeskRouter.post('/tickets', requirePermission('TICKET_CREATE'), controller.create);
helpdeskRouter.get('/tickets/:ticketId', either, controller.get);
helpdeskRouter.post('/tickets/:ticketId/cancel', either, controller.cancel);
helpdeskRouter.get('/assignees', requirePermission('TICKET_ASSIGN'), controller.assignees);
helpdeskRouter.post('/tickets/:ticketId/assign', requirePermission('TICKET_ASSIGN'), controller.assign);
helpdeskRouter.post('/tickets/:ticketId/status', requirePermission('TICKET_RESOLVE'), controller.updateStatus);
helpdeskRouter.post('/tickets/:ticketId/comments', either, controller.addComment);
helpdeskRouter.patch('/tickets/:ticketId/comments/:commentId', either, controller.editComment);
helpdeskRouter.delete('/tickets/:ticketId/comments/:commentId', either, controller.deleteComment);
