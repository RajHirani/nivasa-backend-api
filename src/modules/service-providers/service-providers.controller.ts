import type { Request, RequestHandler } from 'express';
import {
  createProviderSchema,
  householdParamsSchema,
  linkHomeSchema,
  listReviewsSchema,
  providerParamsSchema,
  reviewSchema,
  updateProviderSchema,
} from './service-providers.schema.js';
import * as service from './service-providers.service.js';

export const callerOf = (req: Request): service.Caller => ({
  userId: req.auth!.userId,
  societyId: req.society!.id,
  canManage: req.society!.permissions.has('DIRECTORY_MANAGE'),
});

const providerId = (req: Request) => BigInt(providerParamsSchema.parse(req.params).providerId);

export const listTypes: RequestHandler = async (req, res) => {
  res.json({ items: await service.listServiceTypes(callerOf(req)) });
};

export const create: RequestHandler = async (req, res) => {
  const { provider, created } = await service.createProvider(callerOf(req), createProviderSchema.parse(req.body));
  res.status(created ? 201 : 200).json(provider);
};

export const get: RequestHandler = async (req, res) => {
  res.json(await service.getProvider(callerOf(req), providerId(req)));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await service.updateProvider(callerOf(req), providerId(req), updateProviderSchema.parse(req.body)));
};

export const remove: RequestHandler = async (req, res) => {
  await service.removeProvider(callerOf(req), providerId(req));
  res.status(204).end();
};

export const linkHome: RequestHandler = async (req, res) => {
  const { unitId } = linkHomeSchema.parse(req.body);
  res.json(await service.linkHome(callerOf(req), providerId(req), BigInt(unitId)));
};

export const unlinkHome: RequestHandler = async (req, res) => {
  const { providerId: p, unitId } = householdParamsSchema.parse(req.params);
  await service.unlinkHome(callerOf(req), BigInt(p), BigInt(unitId));
  res.status(204).end();
};

export const listReviews: RequestHandler = async (req, res) => {
  const { limit, cursor } = listReviewsSchema.parse(req.query);
  res.json(await service.listReviews(callerOf(req), providerId(req), limit, cursor));
};

export const saveReview: RequestHandler = async (req, res) => {
  res.json(await service.saveReview(callerOf(req), providerId(req), reviewSchema.parse(req.body)));
};

export const deleteReview: RequestHandler = async (req, res) => {
  await service.deleteReview(callerOf(req), providerId(req));
  res.status(204).end();
};

export const dailyHelp: RequestHandler = async (req, res) => {
  res.json({ items: await service.listDailyHelp(callerOf(req)) });
};
