import type { RequestHandler } from 'express';
import { homeRequestSchema, requestParamsSchema } from './homes.schema.js';
import * as service from './homes.service.js';

export const list: RequestHandler = async (req, res) => {
  res.json({ items: await service.listHomes(req.auth!.userId) });
};

export const get: RequestHandler = async (req, res) => {
  const { requestId } = requestParamsSchema.parse(req.params);
  res.json(await service.getHome(req.auth!.userId, BigInt(requestId)));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createHome(req.auth!.userId, homeRequestSchema.parse(req.body)));
};

export const cancel: RequestHandler = async (req, res) => {
  const { requestId } = requestParamsSchema.parse(req.params);
  await service.cancelHome(req.auth!.userId, BigInt(requestId));
  res.status(204).end();
};
