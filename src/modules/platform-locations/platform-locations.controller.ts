import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as service from './platform-locations.service.js';

const countryQuery = z.object({ countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a two letter country code').default('IN') });

export const listCountries: RequestHandler = async (_req, res) => {
  res.json({ items: await service.listCountries() });
};

export const listStates: RequestHandler = async (req, res) => {
  res.json({ items: await service.listStates(countryQuery.parse(req.query).countryCode) });
};

export const listCities: RequestHandler = async (req, res) => {
  res.json({ items: await service.listCities(String(req.params.stateId)) });
};
