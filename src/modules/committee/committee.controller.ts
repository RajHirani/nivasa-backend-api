import type { RequestHandler } from 'express';
import {
  addMemberSchema, archiveTermSchema, assignmentParamsSchema, changeRoleSchema, listMembersSchema, lookupMemberSchema, renameTermSchema, searchResidentsSchema, termParamsSchema,
} from './committee.schema.js';
import * as service from './committee.service.js';

export const listTerms: RequestHandler = async (req, res) => {
  res.json({ items: await service.listTerms(req.society!.id) });
};

export const listMembers: RequestHandler = async (req, res) => {
  const { termId } = listMembersSchema.parse(req.query);
  res.json({ items: await service.listMembers(req.society!.id, termId) });
};

export const lookupMember: RequestHandler = async (req, res) => {
  res.json(await service.lookupMember(req.society!.id, lookupMemberSchema.parse(req.body)));
};

export const searchResidents: RequestHandler = async (req, res) => {
  const { q } = searchResidentsSchema.parse(req.query);
  res.json({ items: await service.searchResidents(req.society!.id, q) });
};

export const addMember: RequestHandler = async (req, res) => {
  const input = addMemberSchema.parse(req.body);
  res.status(201).json(await service.addMember(req.society!.id, req.auth!.userId, input));
};

export const changeRole: RequestHandler = async (req, res) => {
  const { assignmentId } = assignmentParamsSchema.parse(req.params);
  const { roleId } = changeRoleSchema.parse(req.body);
  await service.changeRole(req.society!.id, req.auth!.userId, BigInt(assignmentId), Number(roleId));
  res.status(204).end();
};

export const removeMember: RequestHandler = async (req, res) => {
  const { assignmentId } = assignmentParamsSchema.parse(req.params);
  await service.removeMember(req.society!.id, req.auth!.userId, BigInt(assignmentId));
  res.status(204).end();
};

export const renameTerm: RequestHandler = async (req, res) => {
  const { termId } = termParamsSchema.parse(req.params);
  const { name } = renameTermSchema.parse(req.body);
  res.json(await service.renameTerm(req.society!.id, req.auth!.userId, BigInt(termId), name));
};

export const archiveTerm: RequestHandler = async (req, res) => {
  const input = archiveTermSchema.parse(req.body);
  res.status(201).json(await service.archiveTerm(req.society!.id, req.auth!.userId, input));
};
