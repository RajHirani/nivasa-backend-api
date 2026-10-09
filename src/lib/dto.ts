import type { BuildingDto, CityDto, CountryDto, FlatDto, SocietyDto } from '../modules/me/me.types.js';

// Row → API shape mappers shared by the modules (ids are bigints in the DB and strings in the API).
export const societyDto = (s: { id: bigint; name: string; city_id: bigint; address: string | null }): SocietyDto => ({
  id: s.id.toString(),
  name: s.name,
  cityId: s.city_id.toString(),
  address: s.address,
});

export const cityDto = (c: { id: bigint; name: string; is_popular: boolean }): CityDto => ({
  id: c.id.toString(),
  name: c.name,
  isPopular: c.is_popular,
});

export const countryDto = (c: { id: bigint; name: string; iso_code: string }): CountryDto => ({
  id: c.id.toString(),
  name: c.name,
  isoCode: c.iso_code,
});

// A unit (flat/house) belongs to a building (wing/section) when it has one; houses may have none.
export const unitInclude = {
  structure_structure_building_idTostructure: { select: { id: true, identifier: true } },
  structure_structure_floor_idTostructure: { select: { floor_number: true } },
} as const;

export type UnitRow = {
  id: bigint;
  identifier: string;
  floor_number: number | null;
  structure_structure_building_idTostructure: { id: bigint; identifier: string } | null;
  structure_structure_floor_idTostructure: { floor_number: number | null } | null;
};

export const buildingDto = (u: UnitRow): BuildingDto | null => {
  const b = u.structure_structure_building_idTostructure;
  return b ? { id: b.id.toString(), name: b.identifier } : null;
};

export const flatDto = (u: UnitRow): FlatDto => ({ id: u.id.toString(), code: u.identifier, floor: u.structure_structure_floor_idTostructure?.floor_number ?? u.floor_number });

export const lower = (code: string): string => code.toLowerCase();
