import type { RequestHandler } from 'express';
import * as service from './roles.service.js';

export const list: RequestHandler = async (req, res) => {
  res.json({ items: await service.listAssignableRoles(req.society!.id) });
};
