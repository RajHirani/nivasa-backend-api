import type { RequestHandler } from 'express';
import { listSocietiesSchema } from './platform-societies.schema.js';
import * as service from './platform-societies.service.js';

export const listSocieties: RequestHandler = async (req, res) => {
  res.json(await service.listSocieties(listSocietiesSchema.parse(req.query)));
};

export const getDashboard: RequestHandler = async (_req, res) => {
  res.json(await service.getDashboard());
};
