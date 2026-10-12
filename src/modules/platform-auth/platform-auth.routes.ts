import { Router } from 'express';
import { platformOtpRequestLimiter, publicAuthLimiter } from '../../middleware/rate-limit.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireAllowedOrigin } from '../../middleware/origin.js';
import * as controller from './platform-auth.controller.js';

// Platform console (Nivas staff) sign in, mounted at /platform.
export const platformRouter = Router();

platformRouter.post('/auth/otp/request', platformOtpRequestLimiter, controller.requestOtp);
platformRouter.post('/auth/otp/verify', publicAuthLimiter, controller.verifyOtp);
// These two are driven by the refresh token cookie, so a browser sends it on its own: check where the request came from.
platformRouter.post('/auth/refresh', publicAuthLimiter, requireAllowedOrigin, controller.refresh);
platformRouter.post('/auth/logout', publicAuthLimiter, requireAllowedOrigin, controller.logout);
platformRouter.get('/me', authenticate, controller.me);
