import type { Prisma } from '@prisma/client';

// Writes new buildings (apartment: building > floors > flats, tenement: section > houses) into a society.
// Used by the final create of the Add society wizard and by "add buildings" on the society page.
// Buildings, then floors, then units, each in one insert; ids are matched back by position (sort_order).

export interface NewBuilding {
  name: string;
  floors?: { number: number; flats: { number: string }[] }[];
  houses?: { number: string }[];
}

export interface StructureTypeIds {
  building: number;
  floor: number;
  unit: number;
}

const CHUNK = 1000;

/** `firstOrder` is the sort_order of the first new building (the buildings the society already has come before). Returns how many units were written. */
export const insertBuildings = async (
  tx: Prisma.TransactionClient,
  societyId: bigint,
  apartment: boolean,
  types: StructureTypeIds,
  buildings: NewBuilding[],
  firstOrder = 0,
): Promise<number> => {
  const created = await tx.structure.createManyAndReturn({
    data: buildings.map((b, i) => ({ society_id: societyId, structure_type_id: types.building, identifier: b.name, sort_order: firstOrder + i })),
    select: { id: true, sort_order: true },
  });
  const buildingIds = new Map(created.map((b) => [b.sort_order - firstOrder, b.id]));

  const units: Prisma.structureCreateManyInput[] = [];
  if (apartment) {
    const floorRows = buildings.flatMap((b, bi) =>
      (b.floors ?? []).map((f, fi) => ({
        bi,
        fi,
        row: { society_id: societyId, structure_type_id: types.floor, identifier: String(f.number), floor_number: f.number, sort_order: fi, parent_id: buildingIds.get(bi)!, building_id: buildingIds.get(bi)! },
      })),
    );
    const floors = await tx.structure.createManyAndReturn({ data: floorRows.map((f) => f.row), select: { id: true, parent_id: true, sort_order: true } });
    const floorIds = new Map(floors.map((f) => [`${f.parent_id}:${f.sort_order}`, f.id]));
    for (const { bi, fi } of floorRows) {
      const buildingId = buildingIds.get(bi)!;
      const floorId = floorIds.get(`${buildingId}:${fi}`)!;
      buildings[bi]!.floors![fi]!.flats.forEach((flat, n) =>
        units.push({ society_id: societyId, structure_type_id: types.unit, identifier: flat.number, sort_order: n, parent_id: floorId, building_id: buildingId, floor_id: floorId }),
      );
    }
  } else {
    buildings.forEach((b, bi) =>
      (b.houses ?? []).forEach((h, n) =>
        units.push({ society_id: societyId, structure_type_id: types.unit, identifier: h.number, sort_order: n, parent_id: buildingIds.get(bi)!, building_id: buildingIds.get(bi)! }),
      ),
    );
  }
  for (let i = 0; i < units.length; i += CHUNK) await tx.structure.createMany({ data: units.slice(i, i + CHUNK) });
  return units.length;
};
