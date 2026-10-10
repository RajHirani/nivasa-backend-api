import { Router } from 'express';
import { healthRouter } from './health.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { uploadsRouter, filesRouter } from '../modules/uploads/uploads.routes.js';
import { locationsRouter } from '../modules/locations/locations.routes.js';
import { homesRouter } from '../modules/homes/homes.routes.js';
import { meRouter } from '../modules/me/me.routes.js';
import { directoryRouter } from '../modules/directory/directory.routes.js';
import { dailyHelpRouter } from '../modules/service-providers/service-providers.routes.js';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { homeRequestsRouter } from '../modules/home-requests/home-requests.routes.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/uploads', uploadsRouter);
apiRouter.use('/files', filesRouter);
apiRouter.use(locationsRouter);
apiRouter.use('/homes', homesRouter);
apiRouter.use('/home-requests', homeRequestsRouter);
apiRouter.use('/directory', directoryRouter);
apiRouter.use('/daily-help', dailyHelpRouter);
apiRouter.use('/admin', adminRouter);
