import { Router } from 'express';
import { publicAuthLimiter } from '../../middleware/rate-limit.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as controller from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/check-mobile', publicAuthLimiter, controller.checkMobile);
authRouter.post('/otp/request', publicAuthLimiter, controller.requestOtp);
authRouter.post('/signup', publicAuthLimiter, controller.signUp);
authRouter.post('/otp/verify', publicAuthLimiter, controller.verifyOtp);
authRouter.post('/refresh', publicAuthLimiter, controller.refresh);
authRouter.post('/logout', authenticate, controller.logout);
