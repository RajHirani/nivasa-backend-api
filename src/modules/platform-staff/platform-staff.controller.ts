import type { RequestHandler } from 'express';
import { changeRoleSchema, inviteStaffSchema, listStaffSchema, reactivateSchema } from './platform-staff.schema.js';
import * as service from './platform-staff.service.js';

const staffId = (value: string | string[] | undefined) => String(value);

export const listRoles: RequestHandler = async (_req, res) => {
  res.json({ items: await service.listRoles() });
};

export const listStaff: RequestHandler = async (req, res) => {
  res.json(await service.listStaff(listStaffSchema.parse(req.query)));
};

export const inviteStaff: RequestHandler = async (req, res) => {
  res.status(201).json(await service.inviteStaff(req.auth!.userId, inviteStaffSchema.parse(req.body)));
};

export const changeRole: RequestHandler = async (req, res) => {
  const { role } = changeRoleSchema.parse(req.body);
  res.json(await service.changeRole(req.auth!.userId, staffId(req.params.staffId), role));
};

export const deactivateStaff: RequestHandler = async (req, res) => {
  res.json(await service.deactivateStaff(req.auth!.userId, staffId(req.params.staffId)));
};

export const reactivateStaff: RequestHandler = async (req, res) => {
  const { role } = reactivateSchema.parse(req.body ?? {});
  res.json(await service.reactivateStaff(req.auth!.userId, staffId(req.params.staffId), role));
};

export const resendInvite: RequestHandler = async (req, res) => {
  await service.resendInvite(staffId(req.params.staffId));
  res.status(204).end();
};
