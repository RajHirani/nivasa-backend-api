import type { RequestHandler } from 'express';
import { activitySchema, deleteSocietySchema, deactivateSchema, listSocietiesSchema, setModuleSchema, updateSocietySchema } from './platform-societies.schema.js';
import * as service from './platform-societies.service.js';
import * as detail from './society-detail.service.js';
import * as update from './society-update.service.js';
import * as admins from './society-admins.service.js';
import { adminEditSchema, adminLookupSchema, adminSchema } from '../platform-society-wizard/society-wizard.schema.js';
import { lookupAdmin as lookup } from '../platform-society-wizard/society-wizard.service.js';
import * as modules from './society-modules.service.js';
import * as removal from './society-delete.service.js';
import * as status from './society-status.service.js';

export const listSocieties: RequestHandler = async (req, res) => {
  res.json(await service.listSocieties(listSocietiesSchema.parse(req.query)));
};

export const getDashboard: RequestHandler = async (_req, res) => {
  res.json(await service.getDashboard());
};

// One society and its tabs. `societyId` that is not an id, or not a society, answers 404.
export const getSociety: RequestHandler = async (req, res) => {
  res.json(await service.getSocietyDetail(detail.parseSocietyId(String(req.params.societyId))));
};

export const getStructure: RequestHandler = async (req, res) => {
  res.json(await detail.getStructure(detail.parseSocietyId(String(req.params.societyId))));
};

export const getAdmins: RequestHandler = async (req, res) => {
  res.json(await detail.getAdmins(detail.parseSocietyId(String(req.params.societyId))));
};

export const listModules: RequestHandler = async (req, res) => {
  res.json(await detail.listModules(detail.parseSocietyId(String(req.params.societyId))));
};

export const listActivity: RequestHandler = async (req, res) => {
  const { page, pageSize } = activitySchema.parse(req.query);
  res.json(await detail.listActivity(detail.parseSocietyId(String(req.params.societyId)), page, pageSize));
};

export const deactivateSociety: RequestHandler = async (req, res) => {
  const { reason } = deactivateSchema.parse(req.body ?? {});
  res.json(await status.deactivateSociety(detail.parseSocietyId(String(req.params.societyId)), req.auth!.userId, reason));
};

export const reactivateSociety: RequestHandler = async (req, res) => {
  res.json(await status.reactivateSociety(detail.parseSocietyId(String(req.params.societyId)), req.auth!.userId));
};

// Edit basic information and location; only the fields sent change. 400 VALIDATION_FAILED, 404, 409 SOCIETY_NAME_TAKEN / REGISTRATION_NUMBER_TAKEN.
export const updateSociety: RequestHandler = async (req, res) => {
  res.json(await update.updateSociety(detail.parseSocietyId(String(req.params.societyId)), req.auth!.userId, updateSocietySchema.parse(req.body ?? {})));
};

// ---- Admins tab. `societyId` and `userId` that are not ids, or not an admin of this society, answer 404.
const sid = (req: Parameters<RequestHandler>[0]) => detail.parseSocietyId(String(req.params.societyId));
const uid = (req: Parameters<RequestHandler>[0]) => admins.parseUserId(String(req.params.userId));

// Has this mobile number an account already? (the Add admin dialog; same answer as step 4 of the wizard)
export const lookupAdmin: RequestHandler = async (req, res) => {
  res.json(await lookup(adminLookupSchema.parse(req.body)));
};

export const addAdmin: RequestHandler = async (req, res) => {
  res.status(201).json(await admins.addAdmin(sid(req), req.auth!.userId, adminSchema.parse(req.body)));
};

export const editAdmin: RequestHandler = async (req, res) => {
  res.json(await admins.editAdmin(sid(req), req.auth!.userId, uid(req), adminEditSchema.parse(req.body ?? {})));
};

export const removeAdmin: RequestHandler = async (req, res) => {
  await admins.removeAdmin(sid(req), req.auth!.userId, uid(req));
  res.status(204).end();
};

// Switch one module on or off. An unknown module code or society answers 404.
export const setModule: RequestHandler = async (req, res) => {
  const { enabled } = setModuleSchema.parse(req.body ?? {});
  res.json(await modules.setSocietyModule(detail.parseSocietyId(String(req.params.societyId)), req.auth!.userId, String(req.params.moduleCode), enabled));
};

// Delete a society and everything in it for good. The body carries the society's exact name as a confirmation.
export const deleteSociety: RequestHandler = async (req, res) => {
  const { name } = deleteSocietySchema.parse(req.body ?? {});
  await removal.deleteSociety(detail.parseSocietyId(String(req.params.societyId)), req.auth!.userId, name);
  res.status(204).end();
};

// Emails the admin that they are the society's President ("Send invite"). 400 when the admin has no email, 502 when the mail fails.
export const inviteAdmin: RequestHandler = async (req, res) => {
  res.json(await admins.inviteAdmin(sid(req), req.auth!.userId, uid(req)));
};
