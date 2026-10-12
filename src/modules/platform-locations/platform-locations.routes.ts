import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePlatformPermission } from '../../middleware/platform.js';
import * as controller from './platform-locations.controller.js';

// Pick lists of the platform console, mounted at /platform. Every platform role may read them (they are used by Add and Edit society).
export const platformLocationsRouter = Router();

const canView = [authenticate, requirePlatformPermission('SOCIETY_VIEW')];
platformLocationsRouter.get('/locations/countries', ...canView, controller.listCountries);
platformLocationsRouter.get('/locations/states', ...canView, controller.listStates);
platformLocationsRouter.get('/locations/states/:stateId/cities', ...canView, controller.listCities);
