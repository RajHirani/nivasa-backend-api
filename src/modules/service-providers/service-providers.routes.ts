import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAnyPermission, requireMembership, requirePermission } from '../../middleware/society.js';
import * as controller from './service-providers.controller.js';

// Service Directory entries (any resident may add one), their daily-help home links and reviews.
// Editing and removing check ownership (creator or DIRECTORY_MANAGE) in the service.
export const serviceProvidersRouter = Router();
serviceProvidersRouter.use(authenticate, requireMembership, requirePermission('DIRECTORY_VIEW'));

serviceProvidersRouter.post('/', requireAnyPermission('SERVICE_PROVIDER_ADD', 'DIRECTORY_MANAGE'), controller.create);
serviceProvidersRouter.get('/:providerId', controller.get);
serviceProvidersRouter.patch('/:providerId', controller.update);
serviceProvidersRouter.delete('/:providerId', controller.remove);

serviceProvidersRouter.post('/:providerId/households', controller.linkHome);
serviceProvidersRouter.delete('/:providerId/households/:unitId', controller.unlinkHome);

serviceProvidersRouter.get('/:providerId/reviews', controller.listReviews);
serviceProvidersRouter.put('/:providerId/review', controller.saveReview);
serviceProvidersRouter.delete('/:providerId/review', controller.deleteReview);

export const serviceTypesRouter = Router();
serviceTypesRouter.get('/', authenticate, requireMembership, requirePermission('DIRECTORY_VIEW'), controller.listTypes);

// "Daily Help": the providers serving the caller's homes.
export const dailyHelpRouter = Router();
dailyHelpRouter.get('/', authenticate, requireMembership, requirePermission('DIRECTORY_VIEW'), controller.dailyHelp);
