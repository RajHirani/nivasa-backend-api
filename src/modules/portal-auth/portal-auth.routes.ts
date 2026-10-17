import { Router } from 'express';
import { publicAuthLimiter } from '../../middleware/rate-limit.js';
import { requireAllowedOrigin } from '../../middleware/origin.js';
import * as controller from './portal-auth.controller.js';

// Committee Portal sign in, mounted at /portal.
export const portalRouter = Router();

portalRouter.post('/auth/otp/verify', publicAuthLimiter, controller.verifyOtp);
// Driven by the refresh token cookie, so a browser sends it on its own: check where the request came from.
portalRouter.post('/auth/refresh', publicAuthLimiter, requireAllowedOrigin, controller.refresh);
portalRouter.post('/auth/logout', publicAuthLimiter, requireAllowedOrigin, controller.logout);
