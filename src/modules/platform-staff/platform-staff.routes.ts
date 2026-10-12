import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './platform-staff.controller.js';

// Nivas staff management, mounted at /platform. Super Admins only (PLATFORM_STAFF_MANAGE).
export const platformStaffRouter = Router();

platformStaffRouter.use(['/staff', '/roles'], authenticate, requirePlatformPermission('PLATFORM_STAFF_MANAGE'));

platformStaffRouter.get('/roles', controller.listRoles);
platformStaffRouter.get('/staff', controller.listStaff);
platformStaffRouter.post('/staff', controller.inviteStaff);
platformStaffRouter.patch('/staff/:staffId', controller.changeRole);
platformStaffRouter.post('/staff/:staffId/deactivate', controller.deactivateStaff);
platformStaffRouter.post('/staff/:staffId/reactivate', controller.reactivateStaff);
platformStaffRouter.post('/staff/:staffId/resend-invite', controller.resendInvite);
