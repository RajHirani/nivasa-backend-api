import type { RequestHandler } from 'express';
import { createRoleSchema, deleteRoleSchema, roleParamsSchema, savePermissionsSchema } from './roles.schema.js';
import * as service from './roles.service.js';

export const list: RequestHandler = async (req, res) => {
  res.json({ items: await service.listAssignableRoles(req.society!.id) });
};

export const overview: RequestHandler = async (req, res) => {
  res.json(await service.overview(req.society!.id));
};

export const create: RequestHandler = async (req, res) => {
  const input = createRoleSchema.parse(req.body);
  res.status(201).json(await service.createRole(req.society!.id, req.auth!.userId, input));
};

export const savePermissions: RequestHandler = async (req, res) => {
  const { roleId } = roleParamsSchema.parse(req.params);
  const { permissions } = savePermissionsSchema.parse(req.body);
  res.json(await service.savePermissions(req.society!.id, Number(roleId), permissions));
};

export const remove: RequestHandler = async (req, res) => {
  const { roleId } = roleParamsSchema.parse(req.params);
  const { moveToRoleId } = deleteRoleSchema.parse(req.body ?? {});
  await service.deleteRole(req.society!.id, req.auth!.userId, Number(roleId), moveToRoleId ? Number(moveToRoleId) : null);
  res.status(204).end();
};
