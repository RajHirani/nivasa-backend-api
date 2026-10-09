import type { RequestHandler } from 'express';
import { listHomeRequestsSchema, rejectSchema, requestParamsSchema } from './home-requests.schema.js';
import * as service from './home-requests.service.js';

export const list: RequestHandler = async (req, res) => {
  const { status, limit, cursor } = listHomeRequestsSchema.parse(req.query);
  res.json(await service.listRequests(req.society!.id, status, limit, cursor));
};

export const get: RequestHandler = async (req, res) => {
  const { requestId } = requestParamsSchema.parse(req.params);
  res.json(await service.getRequest(req.society!.id, BigInt(requestId)));
};

export const approve: RequestHandler = async (req, res) => {
  const { requestId } = requestParamsSchema.parse(req.params);
  res.json(await service.approveRequest(req.society!.id, req.auth!.userId, BigInt(requestId)));
};

export const reject: RequestHandler = async (req, res) => {
  const { requestId } = requestParamsSchema.parse(req.params);
  const { reason } = rejectSchema.parse(req.body);
  res.json(await service.rejectRequest(req.society!.id, req.auth!.userId, BigInt(requestId), reason));
};
