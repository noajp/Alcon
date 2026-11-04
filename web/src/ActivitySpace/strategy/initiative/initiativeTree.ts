// The Strategy list's shapes, kept pure so the rules are testable:
// - which Strategies belong on this Space's pages,
// - the Strategy tree (Strategies nest through strategy_children, as a
//   DAG: one Strategy may sit under several parents, and then shows under
//   each of them).

export interface InitiativeMember { id: string; name: string; activity_space_id?: string | null; created_at?: string; order_index?: number | null; parentIds: string[]; objectIds: string[] }

/** Whether a Strategy belongs to this Space. One with a Space of its own
 *  answers directly; one without (written before Strategies had a Space)
 *  is placed by the caller's fallback. */
export function inSpace(s: { activity_space_id?: string | null }, spaceId: string | null, fallback: () => boolean): boolean {
  return s.activity_space_id ? s.activity_space_id === spaceId : fallback();
}

/** Strategies that belong on this Space's pages: those whose Space it is.
 *  One without a Space reaches it through its Objects' Domains — an Object
 *  in one of the Space's Domains counts, and so does having no Object yet
 *  (nothing places it elsewhere). */
export function initiativesInSpace<T extends InitiativeMember>(
  initiatives: T[],
  objectDomain: Map<string, string | null>,
  spaceDomainIds: Set<string>,
  spaceId: string | null = null,
): T[] {
  return initiatives.filter((s) => inSpace(s, spaceId, () =>
    s.objectIds.length === 0 || s.objectIds.some((oid) => {
      const d = objectDomain.get(oid);
      return !!d && spaceDomainIds.has(d);
    })));
}

export interface InitiativeNode<T> {
  initiative: T;
  depth: number;
  /** The ids from the root down to this node — unique per row, since an
   *  Strategy with two parents appears twice. */
  key: string;
  children: InitiativeNode<T>[];
}

/** Sibling order: the order a person dragged them into, then — for those
 *  never moved — oldest first. */
export function siblingOrder(a: InitiativeMember, b: InitiativeMember): number {
  const ao = a.order_index ?? Number.POSITIVE_INFINITY;
  const bo = b.order_index ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.name.localeCompare(b.name);
}

/** The Strategy tree in display order (siblings in their dragged order, then oldest first). The roots
 *  are the Strategies with no parent in the list. A link that would close
 *  a loop is not followed, and a Strategy the roots never reach (one
 *  caught in a loop) is lifted to the top — every Strategy appears. */
export function buildInitiativeTree<T extends InitiativeMember>(initiatives: T[]): InitiativeNode<T>[] {
  const ids = new Set(initiatives.map((s) => s.id));
  const sorted = [...initiatives].sort(siblingOrder);
  const childrenOf = new Map<string, T[]>();
  for (const s of sorted) for (const p of s.parentIds) if (ids.has(p)) childrenOf.set(p, [...(childrenOf.get(p) ?? []), s]);
  const reached = new Set<string>();
  const build = (s: T, depth: number, path: string[]): InitiativeNode<T> => {
    reached.add(s.id);
    const here = [...path, s.id];
    return {
      initiative: s, depth, key: here.join('/'),
      children: (childrenOf.get(s.id) ?? []).filter((c) => !here.includes(c.id)).map((c) => build(c, depth + 1, here)),
    };
  };
  const tops = sorted.filter((s) => !s.parentIds.some((p) => ids.has(p))).map((s) => build(s, 0, []));
  for (const s of sorted) if (!reached.has(s.id)) tops.push(build(s, 0, []));
  return tops;
}

/** Every row of the tree, depth first — what a folded list renders. */
export function flattenInitiativeTree<T>(nodes: InitiativeNode<T>[], isOpen: (key: string) => boolean): InitiativeNode<T>[] {
  const out: InitiativeNode<T>[] = [];
  const walk = (list: InitiativeNode<T>[]) => {
    for (const n of list) {
      out.push(n);
      if (isOpen(n.key)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Where a dragged row lands relative to the row under the pointer: above
 *  it, below it, or inside it (as its last child). */
export type InitiativeDropPlace = 'before' | 'after' | 'inside';

export interface InitiativeDropPlan {
  id: string;
  /** The parent of the row that was dragged (null: it was at the top). */
  fromParentId: string | null;
  /** The parent it goes under (null: the top). */
  toParentId: string | null;
  /** That level's order afterwards, the moved one included. */
  siblingIds: string[];
}

/** What dropping row `draggedKey` on row `targetKey` at `place` does, or
 *  null when the drop means nothing — onto itself, or into its own branch. */
export function planInitiativeDrop<T extends InitiativeMember>(
  roots: InitiativeNode<T>[],
  draggedKey: string,
  targetKey: string,
  place: InitiativeDropPlace,
): InitiativeDropPlan | null {
  if (draggedKey === targetKey || targetKey.startsWith(`${draggedKey}/`)) return null;
  const parentOf = new Map<string, InitiativeNode<T> | null>();
  const byKey = new Map<string, InitiativeNode<T>>();
  const walk = (list: InitiativeNode<T>[], parent: InitiativeNode<T> | null) => {
    for (const n of list) { byKey.set(n.key, n); parentOf.set(n.key, parent); walk(n.children, n); }
  };
  walk(roots, null);
  const dragged = byKey.get(draggedKey);
  const target = byKey.get(targetKey);
  if (!dragged || !target) return null;
  const id = dragged.initiative.id;
  const fromParent = parentOf.get(draggedKey) ?? null;
  const toParent = place === 'inside' ? target : parentOf.get(targetKey) ?? null;
  // A Strategy cannot go inside itself, wherever else it also shows.
  if (toParent && (toParent.initiative.id === id || toParent.key.split('/').includes(id))) return null;
  const level = (toParent ? toParent.children : roots).map((n) => n.initiative.id).filter((sid) => sid !== id);
  let at = level.length;
  if (place !== 'inside') {
    const i = level.indexOf(target.initiative.id);
    at = i < 0 ? level.length : place === 'before' ? i : i + 1;
  }
  const siblingIds = [...level.slice(0, at), id, ...level.slice(at)];
  return {
    id,
    fromParentId: fromParent?.initiative.id ?? null,
    toParentId: toParent?.initiative.id ?? null,
    siblingIds: [...new Set(siblingIds)],
  };
}
