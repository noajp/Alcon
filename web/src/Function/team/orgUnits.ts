// Pure reads of the unit tree (hooks/orgUnitData): what sits under a unit,
// the path down to it, and who is in it counting the units inside it.

export interface UnitNode { id: string; parent_id: string | null; name: string; position: number }
export interface UnitMembership { unit_id: string; worker_id: string }

/** A unit's children, in their order. */
export function childUnits<T extends UnitNode>(units: readonly T[], parentId: string | null): T[] {
  return units.filter((u) => u.parent_id === parentId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** The units from the top down to `unitId`, itself last. A unit whose parent
 *  is missing (not visible, or a broken link) starts the path. */
export function unitPath<T extends UnitNode>(units: readonly T[], unitId: string): T[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const path: T[] = [];
  const seen = new Set<string>();
  for (let u = byId.get(unitId); u && !seen.has(u.id); u = u.parent_id ? byId.get(u.parent_id) : undefined) {
    seen.add(u.id);
    path.unshift(u);
  }
  return path;
}

/** `unitId` and every unit under it, at any depth. */
function unitAndBelow(units: readonly UnitNode[], unitId: string): Set<string> {
  const out = new Set<string>([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) if (u.parent_id && out.has(u.parent_id) && !out.has(u.id)) { out.add(u.id); grew = true; }
  }
  return out;
}

/** Who is in a unit or any unit under it, each once. */
export function membersBelow(units: readonly UnitNode[], members: readonly UnitMembership[], unitId: string): string[] {
  const ids = unitAndBelow(units, unitId);
  return [...new Set(members.filter((m) => ids.has(m.unit_id)).map((m) => m.worker_id))];
}

/** The units a Worker belongs to directly. */
export function unitsOf<T extends UnitNode>(units: readonly T[], members: readonly UnitMembership[], workerId: string): T[] {
  const ids = new Set(members.filter((m) => m.worker_id === workerId).map((m) => m.unit_id));
  return units.filter((u) => ids.has(u.id));
}
