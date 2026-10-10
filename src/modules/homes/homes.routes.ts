import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './homes.controller.js';

// The caller's own homes and home requests. The path id is always the request id.
export const homesRouter = Router();

homesRouter.get('/', authenticate, controller.list);
homesRouter.post('/', authenticate, controller.create);
homesRouter.get('/:requestId', authenticate, controller.get);
homesRouter.delete('/:requestId', authenticate, controller.cancel);
