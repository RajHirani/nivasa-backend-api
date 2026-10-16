import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './platform-societies.controller.js';

// Society management for Nivas staff, mounted at /platform.
export const platformSocietiesRouter = Router();

platformSocietiesRouter.get('/dashboard', authenticate, requirePlatformPermission('SOCIETY_VIEW'), controller.getDashboard);
platformSocietiesRouter.get('/societies', authenticate, requirePlatformPermission('SOCIETY_VIEW'), controller.listSocieties);

const canView = [authenticate, requirePlatformPermission('SOCIETY_VIEW')];
platformSocietiesRouter.get('/societies/:societyId', ...canView, controller.getSociety);
platformSocietiesRouter.get('/societies/:societyId/structure', ...canView, controller.getStructure);
platformSocietiesRouter.get('/societies/:societyId/admins', ...canView, controller.getAdmins);
platformSocietiesRouter.get('/societies/:societyId/modules', ...canView, controller.listModules);
platformSocietiesRouter.get('/societies/:societyId/activity', ...canView, controller.listActivity);

const canChangeStatus = [authenticate, requirePlatformPermission('SOCIETY_STATUS_CHANGE')];
platformSocietiesRouter.post('/societies/:societyId/deactivate', ...canChangeStatus, controller.deactivateSociety);
platformSocietiesRouter.post('/societies/:societyId/reactivate', ...canChangeStatus, controller.reactivateSociety);
platformSocietiesRouter.patch('/societies/:societyId', authenticate, requirePlatformPermission('SOCIETY_UPDATE'), controller.updateSociety);

// Admins tab: adding, editing and removing admins is "updating the society".
const canUpdate = [authenticate, requirePlatformPermission('SOCIETY_UPDATE')];
platformSocietiesRouter.post('/societies/:societyId/admins/lookup', ...canUpdate, controller.lookupAdmin);
platformSocietiesRouter.post('/societies/:societyId/admins', ...canUpdate, controller.addAdmin);
platformSocietiesRouter.patch('/societies/:societyId/admins/:userId', ...canUpdate, controller.editAdmin);
platformSocietiesRouter.delete('/societies/:societyId/admins/:userId', ...canUpdate, controller.removeAdmin);
platformSocietiesRouter.put('/societies/:societyId/modules/:moduleCode', authenticate, requirePlatformPermission('SOCIETY_UPDATE'), controller.setModule);

// Deleting a society for good is its own permission, held only by the Super Admin.
platformSocietiesRouter.delete('/societies/:societyId', authenticate, requirePlatformPermission('SOCIETY_DELETE'), controller.deleteSociety);
platformSocietiesRouter.post('/societies/:societyId/admins/:userId/invite', ...canUpdate, controller.inviteAdmin);
