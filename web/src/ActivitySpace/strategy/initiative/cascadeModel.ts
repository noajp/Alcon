// The Cascade down: one Strategy and everything nested under it, level
// by level — the root, its children, their children, as deep as the
// nesting goes. Strategies form a DAG (a child can hang under several
// parents), not a tree, so the levels are a breadth-first reading: each
// Strategy appears once, at the shallowest depth the descent from this
// root reaches it. A cycle — which the table's guard forbids but a read
// must never trust — cannot loop: a visited Strategy is not descended
// into again.
//
// Pure on purpose: no React, no Supabase. The order within a level is the
// order the Strategies stand in the input, which is the list's order.

/** The least of a Strategy the cascade reads: its id and its parents. */
export interface CascadeNode {
  id: string;
  /** Parent Strategy ids from strategy_children. Empty for a top level. */
  parentIds: string[];
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
