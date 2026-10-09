import type { RequestHandler } from 'express';
import * as meService from './me.service.js';

export const getMe: RequestHandler = async (req, res) => {
  res.json(await meService.getMe(req.auth!.userId));
};

export const listSocieties: RequestHandler = async (req, res) => {
  res.json({ items: await meService.listMemberships(req.auth!.userId) });
};
