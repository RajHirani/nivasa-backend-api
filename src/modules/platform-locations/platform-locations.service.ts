import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../utils/api-error.js';

// Pick lists for the console's location fields: country, then state, then city. Only active rows are offered.

export const listCountries = async () => {
  const rows = await prisma.country.findMany({ where: { is_active: true }, orderBy: { name: 'asc' }, select: { iso_code: true, name: true, dial_code: true } });
  return rows.map((c) => ({ code: c.iso_code, name: c.name, dialCode: c.dial_code }));
};

export const listStates = async (countryCode: string) => {
  const country = await prisma.country.findFirst({ where: { iso_code: countryCode, is_active: true }, select: { id: true } });
  if (!country) throw new ApiError(404, 'NOT_FOUND', 'Country not found');
  const rows = await prisma.state.findMany({ where: { country_id: country.id, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return rows.map((s) => ({ id: s.id.toString(), name: s.name }));
};

export const listCities = async (stateId: string) => {
  if (!/^[0-9]{1,18}$/.test(stateId)) throw new ApiError(404, 'NOT_FOUND', 'State not found');
  const state = await prisma.state.findFirst({ where: { id: BigInt(stateId), is_active: true, country: { is_active: true } }, select: { id: true } });
  if (!state) throw new ApiError(404, 'NOT_FOUND', 'State not found');
  const rows = await prisma.city.findMany({ where: { state_id: state.id, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return rows.map((c) => ({ id: c.id.toString(), name: c.name }));
};
