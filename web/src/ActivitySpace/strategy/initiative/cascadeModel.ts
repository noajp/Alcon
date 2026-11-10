// The Cascade: one Strategy and its whole lineage, level by level —
// the root, its children, their children, as deep as the nesting goes,
// and the same walk upward through its parents to the top of the DAG.
// Strategies form a DAG (a child can hang under several parents), not a
// tree, so the levels are a breadth-first reading: each Strategy
// appears once, at the shallowest depth the walk from this root reaches
// it. A cycle — which the table's guard forbids but a read must never
// trust — cannot loop: a visited Strategy is not walked into again.
//
// Pure on purpose: no React, no Supabase. The order within a level is the
// order the Strategies stand in the input, which is the list's order.

/** The least of a Strategy the cascade reads: its id and its parents. */
export interface CascadeNode {
  id: string;
  /** Parent Strategy ids from strategy_children. Empty for a top level. */
  parentIds: string[];
  /** Object ids from strategy_objects, in the junction's order. */
  objectIds?: readonly string[];
}

/** The least of an Object the cascade reads: the face of its chip. */
export interface CascadeObjectRef {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  domain_id: string | null;
}

/** How many Object chips stand under one Strategy's card before the
 *  rest fold into the count chip. The full list is one click away on
 *  the Strategy's Overview; the cascade shows the shape, not the
 *  inventory. */
export const CASCADE_OBJECT_CHIP_CAP = 6;

/**
 * The Object chips of one Strategy: its objectIds resolved against the
 * Object rows, in the junction's own order, capped — the rest counted,
 * never listed. An id with no matching row is skipped silently, the
 * same discipline as the cascade's byId guard for Strategies; a
 * repeated id stands once, at its first place.
 */
export function cascadeObjectChips<T extends CascadeObjectRef>(
  objectIds: readonly string[],
  objectsById: ReadonlyMap<string, T>,
  cap: number = CASCADE_OBJECT_CHIP_CAP,
): { chips: T[]; overflow: number } {
  const resolved: T[] = [];
  const seen = new Set<string>();
  for (const id of objectIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const object = objectsById.get(id);
    if (object) resolved.push(object);
  }
  const chips = resolved.slice(0, cap);
  return { chips, overflow: resolved.length - chips.length };
}

/**
 * The levels under (and including) one Strategy: level 0 is the root
 * alone, level 1 its children, and so on. Each level holds Strategy ids.
 * An id the input does not contain cannot be a root — the result is
 * empty then, rather than a level naming a Strategy nobody can draw.
 */
export function cascadeLevels(rootId: string, strategies: readonly CascadeNode[]): string[][] {
  const known = new Set(strategies.map((s) => s.id));
  if (!known.has(rootId)) return [];
  // The children of each Strategy, in the input's order.
  const childrenOf = new Map<string, string[]>();
  for (const s of strategies) {
    for (const parentId of s.parentIds) {
      if (!known.has(parentId)) continue;
      const list = childrenOf.get(parentId) ?? [];
      list.push(s.id);
      childrenOf.set(parentId, list);
    }
  }
  const levels: string[][] = [];
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    levels.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const childId of childrenOf.get(id) ?? []) {
        if (visited.has(childId)) continue;
        visited.add(childId);
        next.push(childId);
      }
    }
    frontier = next;
  }
  return levels;
}

/**
 * The levels above one Strategy: level 0 is its parents, level 1 its
 * grandparents, and so on up to the roots of the DAG. The exact mirror
 * of cascadeLevels, walking parentIds instead of children — each
 * Strategy once, at its shallowest upward distance, in input order
 * within a level, cycle-safe the same way. The root itself is not a
 * level here. A root the input does not contain, or one with no
 * parents, gives an empty result.
 */
export function ancestorLevels(rootId: string, strategies: readonly CascadeNode[]): string[][] {
  const known = new Set(strategies.map((s) => s.id));
  if (!known.has(rootId)) return [];
  const parentsOf = new Map(strategies.map((s) => [s.id, s.parentIds] as const));
  const levels: string[][] = [];
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const wanted = new Set<string>();
    for (const id of frontier) {
      for (const parentId of parentsOf.get(id) ?? []) {
        if (known.has(parentId) && !visited.has(parentId)) wanted.add(parentId);
      }
    }
    if (wanted.size === 0) break;
    const next = strategies.filter((s) => wanted.has(s.id)).map((s) => s.id);
    for (const id of next) visited.add(id);
    levels.push(next);
    frontier = next;
  }
  return levels;
}

/**
 * The full lineage of one Strategy, root-first: the ancestor levels
 * with the highest generation first, then the Strategy alone, then its
 * descendant levels. One shown-set spans both directions — a Strategy
 * placed in an ancestor level (or the root) is not repeated in a
 * descendant level, so in a cross-linked lineage the ancestors win; a
 * descendant level the filter empties is dropped. A top-level Strategy
 * reads exactly as cascadeLevels does. An unknown root gives [].
 */
export function cascadeLineage(rootId: string, strategies: readonly CascadeNode[]): string[][] {
  const down = cascadeLevels(rootId, strategies);
  if (down.length === 0) return [];
  const up = ancestorLevels(rootId, strategies);
  const shown = new Set<string>([rootId, ...up.flat()]);
  const lineage: string[][] = [...up.reverse(), [rootId]];
  for (const level of down.slice(1)) {
    const kept = level.filter((id) => !shown.has(id));
    for (const id of kept) shown.add(id);
    if (kept.length > 0) lineage.push(kept);
  }
  return lineage;
}
