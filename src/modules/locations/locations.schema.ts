import { z } from 'zod';

const id = (field: string) => z.string().regex(/^[0-9]{1,18}$/, `Invalid ${field}`);
const limit = z.coerce.number().int().min(1).max(100).default(20);

export const listCountriesSchema = z.object({ q: z.string().trim().max(100).optional() });

export const listCitiesSchema = z.object({
  countryId: id('countryId'),
  popular: z.enum(['true', 'false']).default('false'),
  q: z.string().trim().max(100).optional(),
});

export const searchSocietiesSchema = z.object({
  cityId: id('cityId'),
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100).optional(),
  limit,
  cursor: z.string().max(500).optional(),
});

export const societyParamsSchema = z.object({ societyId: id('societyId') });
export const buildingParamsSchema = z.object({ buildingId: id('buildingId') });
export const listFlatsSchema = z.object({ q: z.string().trim().max(50).optional() });
