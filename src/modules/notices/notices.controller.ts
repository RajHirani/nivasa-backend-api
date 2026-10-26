import type { Request, RequestHandler } from 'express';
import { createNoticeSchema, listNoticesSchema, noticeParamsSchema, updateNoticeSchema } from './notices.schema.js';
import { getNotice, getOptions, listNotices, noticeCounts, type Ctx } from './notices.read.js';
import * as service from './notices.service.js';

const ctxOf = (req: Request): Ctx => ({ societyId: req.society!.id, userId: req.auth!.userId, permissions: req.society!.permissions });

export const options: RequestHandler = async (_req, res) => {
  res.json(await getOptions());
};

export const counts: RequestHandler = async (req, res) => {
  res.json(await noticeCounts(ctxOf(req)));
};

export const list: RequestHandler = async (req, res) => {
  res.json(await listNotices(ctxOf(req), listNoticesSchema.parse(req.query)));
};

export const get: RequestHandler = async (req, res) => {
  const { noticeId } = noticeParamsSchema.parse(req.params);
  res.json(await getNotice(ctxOf(req), BigInt(noticeId)));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createNotice(ctxOf(req), createNoticeSchema.parse(req.body)));
};

export const update: RequestHandler = async (req, res) => {
  const { noticeId } = noticeParamsSchema.parse(req.params);
  res.json(await service.updateNotice(ctxOf(req), BigInt(noticeId), updateNoticeSchema.parse(req.body)));
};

export const remove: RequestHandler = async (req, res) => {
  const { noticeId } = noticeParamsSchema.parse(req.params);
  await service.deleteNotice(ctxOf(req), BigInt(noticeId));
  res.status(204).end();
};
