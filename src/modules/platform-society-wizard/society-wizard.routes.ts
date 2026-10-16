import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './society-wizard.controller.js';

// Step checks of the "Add society" wizard, mounted at /platform. One endpoint per wizard step.
export const societyWizardRouter = Router();

societyWizardRouter.post('/society-wizard/basic-info', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkBasicInfo);
societyWizardRouter.post('/society-wizard/location', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkLocation);
societyWizardRouter.post('/society-wizard/structure', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkStructure);
societyWizardRouter.post('/society-wizard/admin', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkAdmin);
societyWizardRouter.post('/society-wizard/admin/lookup', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.lookupAdmin);
societyWizardRouter.post('/society-wizard/modules', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.checkModules);
societyWizardRouter.get('/modules', authenticate, requirePlatformPermission('SOCIETY_VIEW'), controller.listModules);
// The final call: one transaction. (GET /societies lives in platform-societies.)
societyWizardRouter.post('/societies', authenticate, requirePlatformPermission('SOCIETY_CREATE'), controller.createSociety);
