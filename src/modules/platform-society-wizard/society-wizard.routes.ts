import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './society-wizard.controller.js';

// Step checks of the "Add society" wizard, mounted at /platform. One endpoint per wizard step.
export const societyWizardRouter = Router();

societyWizardRouter.post('/society-wizard/basic-info', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkBasicInfo);
societyWizardRouter.post('/society-wizard/location', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkLocation);
