import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requireMembership, requirePermission } from '../../middleware/society.js';
import { serviceProvidersRouter, serviceTypesRouter } from '../service-providers/service-providers.routes.js';
import * as controller from './directory.controller.js';

// Everything under /directory needs the active society (X-Society-Id) and DIRECTORY_VIEW.
export const directoryRouter = Router();

directoryRouter.get('/blocks', authenticate, requireMembership, requirePermission('DIRECTORY_VIEW'), controller.listBlocks);
directoryRouter.get('/blocks/:blockId', authenticate, requireMembership, requirePermission('DIRECTORY_VIEW'), controller.getBlock);
directoryRouter.get('/contacts', authenticate, requireMembership, requirePermission('DIRECTORY_VIEW'), controller.listContacts);
directoryRouter.use('/service-types', serviceTypesRouter);
directoryRouter.use('/service-providers', serviceProvidersRouter);
