import type { Request, RequestHandler } from 'express';
import {
  assignSchema, cancelSchema, commentParamsSchema, commentSchema, createTicketSchema, editCommentSchema, listTicketsSchema, ticketParamsSchema, updateStatusSchema,
} from './helpdesk.schema.js';
import { getOptions, getTicket, listTickets, ticketCounts, type Ctx } from './helpdesk.read.js';
import * as service from './helpdesk.service.js';

const ctxOf = (req: Request): Ctx => ({ societyId: req.society!.id, userId: req.auth!.userId, permissions: req.society!.permissions });

export const options: RequestHandler = async (_req, res) => {
  res.json(await getOptions());
};

export const list: RequestHandler = async (req, res) => {
  res.json(await listTickets(ctxOf(req), listTicketsSchema.parse(req.query)));
};

export const counts: RequestHandler = async (req, res) => {
  res.json(await ticketCounts(ctxOf(req)));
};

export const get: RequestHandler = async (req, res) => {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  res.json(await getTicket(ctxOf(req), BigInt(ticketId)));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createTicket(ctxOf(req), createTicketSchema.parse(req.body)));
};

export const cancel: RequestHandler = async (req, res) => {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  const { reason } = cancelSchema.parse(req.body);
  res.json(await service.cancelTicket(ctxOf(req), BigInt(ticketId), reason));
};

export const assignees: RequestHandler = async (req, res) => {
  res.json({ items: await service.listAssignees(ctxOf(req)) });
};

export const assign: RequestHandler = async (req, res) => {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  const { assigneeId } = assignSchema.parse(req.body);
  res.json(await service.assignTicket(ctxOf(req), BigInt(ticketId), BigInt(assigneeId)));
};

export const updateStatus: RequestHandler = async (req, res) => {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  res.json(await service.updateStatus(ctxOf(req), BigInt(ticketId), updateStatusSchema.parse(req.body)));
};

export const addComment: RequestHandler = async (req, res) => {
  const { ticketId } = ticketParamsSchema.parse(req.params);
  res.status(201).json(await service.addComment(ctxOf(req), BigInt(ticketId), commentSchema.parse(req.body)));
};

export const editComment: RequestHandler = async (req, res) => {
  const { ticketId, commentId } = commentParamsSchema.parse(req.params);
  const { body } = editCommentSchema.parse(req.body);
  res.json(await service.editComment(ctxOf(req), BigInt(ticketId), BigInt(commentId), body));
};

export const deleteComment: RequestHandler = async (req, res) => {
  const { ticketId, commentId } = commentParamsSchema.parse(req.params);
  await service.deleteComment(ctxOf(req), BigInt(ticketId), BigInt(commentId));
  res.status(204).end();
};
