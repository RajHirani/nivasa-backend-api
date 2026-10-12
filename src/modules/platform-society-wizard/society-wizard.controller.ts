import type { RequestHandler } from 'express';
import { basicInfoSchema, locationSchema } from './society-wizard.schema.js';
import * as service from './society-wizard.service.js';

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
