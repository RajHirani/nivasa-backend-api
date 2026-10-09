import type { RequestHandler } from 'express';
import { checkMobileSchema, requestOtpSchema, signUpSchema, verifyOtpSchema, refreshSchema, logoutSchema } from './auth.schema.js';
import * as authService from './auth.service.js';

export const checkMobile: RequestHandler = async (req, res) => {
  const { countryCode, mobile } = checkMobileSchema.parse(req.body);
  res.json({ exists: await authService.mobileExists(countryCode, mobile) });
};

export const requestOtp: RequestHandler = async (req, res) => {
  const { countryCode, mobile } = requestOtpSchema.parse(req.body);
  res.json(await authService.requestLoginOtp(countryCode, mobile));
};

export const signUp: RequestHandler = async (req, res) => {
  const { countryCode, mobile, name, email } = signUpSchema.parse(req.body);
  res.json(await authService.signUp(countryCode, mobile, name, email));
};

export const verifyOtp: RequestHandler = async (req, res) => {
  const { countryCode, mobile, otp } = verifyOtpSchema.parse(req.body);
  res.json(await authService.verifyOtp(countryCode, mobile, otp, { ipAddress: req.ip }));
};

export const refresh: RequestHandler = async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json(await authService.refreshTokens(refreshToken));
};

export const logout: RequestHandler = async (req, res) => {
  const { refreshToken } = logoutSchema.parse(req.body);
  await authService.logout(req.auth!, refreshToken);
  res.status(204).end();
};
