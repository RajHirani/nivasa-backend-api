import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireMembership, requirePermission } from '../../middleware/society.js';
import * as controller from './committee.controller.js';

// The committee of the active society (X-Society-Id): members of a term, role changes and term archiving.
export const committeeRouter = Router();

committeeRouter.use(authenticate, requireMembership);
committeeRouter.get('/terms', requirePermission('COMMITTEE_VIEW'), controller.listTerms);
committeeRouter.get('/members', requirePermission('COMMITTEE_VIEW'), controller.listMembers);
committeeRouter.get('/residents', requirePermission('COMMITTEE_MANAGE'), controller.searchResidents);
committeeRouter.post('/members/lookup', requirePermission('COMMITTEE_MANAGE'), controller.lookupMember);
committeeRouter.post('/members', requirePermission('COMMITTEE_MANAGE'), controller.addMember);
committeeRouter.patch('/assignments/:assignmentId', requirePermission('COMMITTEE_MANAGE'), controller.changeRole);
committeeRouter.delete('/assignments/:assignmentId', requirePermission('COMMITTEE_MANAGE'), controller.removeMember);
committeeRouter.patch('/terms/:termId', requirePermission('COMMITTEE_TERM_MANAGE'), controller.renameTerm);
committeeRouter.post('/terms/archive', requirePermission('COMMITTEE_TERM_MANAGE'), controller.archiveTerm);
