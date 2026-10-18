import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireMembership, requirePermission } from '../../middleware/society.js';
import * as controller from './roles.controller.js';

// Roles of the active society (X-Society-Id). The Roles screen (overview, create, permissions, delete) needs ROLE_MANAGE.
export const rolesRouter = Router();

rolesRouter.use(authenticate, requireMembership);
rolesRouter.get('/', requireAnyPermission('COMMITTEE_MANAGE', 'ROLE_MANAGE'), controller.list);
rolesRouter.get('/overview', requirePermission('ROLE_MANAGE'), controller.overview);
rolesRouter.post('/', requirePermission('ROLE_MANAGE'), controller.create);
rolesRouter.put('/:roleId/permissions', requirePermission('ROLE_MANAGE'), controller.savePermissions);
rolesRouter.delete('/:roleId', requirePermission('ROLE_MANAGE'), controller.remove);
