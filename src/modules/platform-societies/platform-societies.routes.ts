import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './platform-societies.controller.js';

// Society management for Nivas staff, mounted at /platform.
export const platformSocietiesRouter = Router();

platformSocietiesRouter.get('/dashboard', authenticate, requirePlatformPermission('SOCIETY_VIEW'), controller.getDashboard);
platformSocietiesRouter.get('/societies', authenticate, requirePlatformPermission('SOCIETY_VIEW'), controller.listSocieties);
