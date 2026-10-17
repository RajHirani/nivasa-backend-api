import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { callerOf } from '../service-providers/service-providers.controller.js';
import { blockParamsSchema, contactParamsSchema, createContactSchema, listContactsSchema, listResidentsSchema, updateContactSchema } from './directory.schema.js';
import * as contacts from './contacts-manage.service.js';
import * as service from './directory.service.js';
import * as residents from './residents.service.js';

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

// ── committee portal ──

export const listResidents: RequestHandler = async (req, res) => {
  res.json(await residents.listResidents(req.society!.id, listResidentsSchema.parse(req.query)));
};

export const summary: RequestHandler = async (req, res) => {
  res.json(await residents.summary(req.society!.id, env.directory.guardRoleCodes));
};

export const createContact: RequestHandler = async (req, res) => {
  res.status(201).json(await contacts.createContact(req.society!.id, req.auth!.userId, createContactSchema.parse(req.body)));
};

export const updateContact: RequestHandler = async (req, res) => {
  const { societyContactId } = contactParamsSchema.parse(req.params);
  res.json(await contacts.updateContact(req.society!.id, societyContactId, updateContactSchema.parse(req.body)));
};

export const removeContact: RequestHandler = async (req, res) => {
  const { societyContactId } = contactParamsSchema.parse(req.params);
  await contacts.removeContact(req.society!.id, societyContactId);
  res.status(204).end();
};

export const listOccupancyStatuses: RequestHandler = async (_req, res) => {
  res.json({ items: await residents.listOccupancyStatuses() });
};
