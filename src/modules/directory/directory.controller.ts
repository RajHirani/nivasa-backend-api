import type { RequestHandler } from 'express';
import { callerOf } from '../service-providers/service-providers.controller.js';
import { blockParamsSchema, listContactsSchema } from './directory.schema.js';
import * as service from './directory.service.js';

export const listBlocks: RequestHandler = async (req, res) => {
  res.json({ items: await service.listBlocks(req.society!.id) });
};

export const getBlock: RequestHandler = async (req, res) => {
  const { blockId } = blockParamsSchema.parse(req.params);
  res.json(await service.getBlock(req.society!.id, req.auth!.userId, BigInt(blockId)));
};

export const listContacts: RequestHandler = async (req, res) => {
  const { type } = listContactsSchema.parse(req.query);
  res.json({ items: await service.listContacts(callerOf(req), type) });
};
