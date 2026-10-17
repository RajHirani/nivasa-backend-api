import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireMembership } from '../../middleware/society.js';
import * as controller from './roles.controller.js';

// Roles of the active society (X-Society-Id). Create / edit / delete come with the Roles screen.
export const rolesRouter = Router();

rolesRouter.use(authenticate, requireMembership);
rolesRouter.get('/', requireAnyPermission('COMMITTEE_MANAGE', 'ROLE_MANAGE'), controller.list);
