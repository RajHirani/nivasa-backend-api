import { Router } from 'express';
import { publicAuthLimiter } from '../../middleware/rate-limit.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './locations.controller.js';

// Pickers of the Add Home form. Any signed-in user may call them (they are not society-scoped yet).
export const locationsRouter = Router();

// Public: the sign in screens need the dial codes before anyone is signed in.
locationsRouter.get('/countries', publicAuthLimiter, controller.listCountries);
locationsRouter.get('/cities', authenticate, controller.listCities);
locationsRouter.get('/societies', authenticate, controller.searchSocieties);
locationsRouter.get('/societies/:societyId/buildings', authenticate, controller.listBuildings);
locationsRouter.get('/buildings/:buildingId/flats', authenticate, controller.listFlats);
