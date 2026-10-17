import type { RequestHandler } from 'express';
import { ApiError } from '../../utils/api-error.js';
import { listHomeRequestsSchema, rejectSchema, requestParamsSchema } from './home-requests.schema.js';
import * as service from './home-requests.service.js';

export const list: RequestHandler = async (req, res) => {
  const query = listHomeRequestsSchema.parse(req.query);
  if (query.page !== undefined) {
    res.json(await service.listRequestsPage(req.society!.id, { ...query, page: query.page }));
    return;
  }
  if (query.status === 'ALL') {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid input', [{ field: 'status', message: 'ALL needs the page parameter' }]);
  }
  res.json(await service.listRequests(req.society!.id, query.status, query.limit, query.cursor));
};

export const counts: RequestHandler = async (req, res) => {
  res.json(await service.requestCounts(req.society!.id));
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
