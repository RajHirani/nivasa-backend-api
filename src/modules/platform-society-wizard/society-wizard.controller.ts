import type { RequestHandler } from 'express';
import { basicInfoSchema, locationSchema, structureSchema, adminSchema, adminLookupSchema, modulesSchema, societyCreateSchema } from './society-wizard.schema.js';
import * as service from './society-wizard.service.js';
import { createSociety as create } from './society-create.service.js';

// Step 1: answers with the cleaned values, or 400 VALIDATION_FAILED / 409 REGISTRATION_NUMBER_TAKEN naming the field.
// Nothing is saved.
export const checkBasicInfo: RequestHandler = async (req, res) => {
  res.json(await service.checkBasicInfo(req.auth!.userId, basicInfoSchema.parse(req.body)));
};

// Step 2: needs the society name from step 1 as well, for the "unique per city" rule.
// Answers the cleaned values and the city, state and country names, or 400 VALIDATION_FAILED / 409 SOCIETY_NAME_TAKEN naming the field.
export const checkLocation: RequestHandler = async (req, res) => {
  res.json(await service.checkLocation(locationSchema.parse(req.body)));
};

// Step 3: answers the cleaned structure with its totals, or 400 VALIDATION_FAILED with the path of each problem
// (for example `buildings.0.floors.1.flats.2.number`). Nothing is saved.
export const checkStructure: RequestHandler = (req, res) => {
  res.json(service.checkStructure(structureSchema.parse(req.body)));
};

// Step 4: answers the person as they will be, and whether their account already exists (then it is reused as it is), or
// 400 VALIDATION_FAILED / 409 EMAIL_ALREADY_EXISTS naming the field. Nothing is saved.
export const checkAdmin: RequestHandler = async (req, res) => {
  res.json(await service.checkAdmin(adminSchema.parse(req.body)));
};

// Step 4, first part: has this mobile number an account already? Answers its name and email so the form can be filled in.
// (POST, so the number does not end up in a URL or an access log.)
export const lookupAdmin: RequestHandler = async (req, res) => {
  res.json(await service.lookupAdmin(adminLookupSchema.parse(req.body)));
};

// The module catalogue (Step 5 shows it; every module is on by default).
export const listModules: RequestHandler = async (_req, res) => {
  res.json({ items: await service.listModules() });
};

// Step 5: answers the chosen module codes, or 400 VALIDATION_FAILED for an unknown one. Nothing is saved.
export const checkModules: RequestHandler = async (req, res) => {
  res.json(await service.checkModules(modulesSchema.parse(req.body)));
};

// Step 6: creates the society, its structure, modules and first admin in one transaction. The body is typed by societyCreateSchema;
// what the steps checked in the database is not checked again (see society-create.service.ts).
export const createSociety: RequestHandler = async (req, res) => {
  res.status(201).json(await create(req.auth!.userId, societyCreateSchema.parse(req.body)));
};
