import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './me.controller.js';

export const meRouter = Router();

meRouter.get('/', authenticate, controller.getMe);
meRouter.get('/societies', authenticate, controller.listSocieties);
