import type { RequestHandler } from 'express';
import {
  buildingParamsSchema,
  listCitiesSchema,
  listCountriesSchema,
  listFlatsSchema,
  searchSocietiesSchema,
  societyParamsSchema,
} from './locations.schema.js';
import * as service from './locations.service.js';

export const listCountries: RequestHandler = async (req, res) => {
  const { q } = listCountriesSchema.parse(req.query);
  res.json({ items: await service.listCountries(q) });
};

export const listCities: RequestHandler = async (req, res) => {
  const { countryId, popular, q } = listCitiesSchema.parse(req.query);
  res.json({ items: await service.listCities(BigInt(countryId), popular === 'true', q) });
};

export const searchSocieties: RequestHandler = async (req, res) => {
  const { cityId, q, limit, cursor } = searchSocietiesSchema.parse(req.query);
  res.json(await service.searchSocieties(BigInt(cityId), q, limit, cursor));
};

export const listBuildings: RequestHandler = async (req, res) => {
  const { societyId } = societyParamsSchema.parse(req.params);
  res.json({ items: await service.listBuildings(BigInt(societyId)) });
};

export const listFlats: RequestHandler = async (req, res) => {
  const { buildingId } = buildingParamsSchema.parse(req.params);
  const { q } = listFlatsSchema.parse(req.query);
  res.json({ items: await service.listFlats(BigInt(buildingId), q) });
};
