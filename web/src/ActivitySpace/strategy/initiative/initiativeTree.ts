// The Initiative list's shapes, kept pure so the rules are testable:
// - which Initiatives belong on this Space's pages,
// - the Initiative tree (Initiatives nest through strategy_children, as a
//   DAG: one Initiative may sit under several parents, and then shows under
//   each of them).

export interface InitiativeMember { id: string; name: string; vision_id: string | null; activity_space_id?: string | null; created_at?: string; parentIds: string[]; objectIds: string[] }

/** Whether an Initiative belongs to this Space. One with a Space of its own
 *  answers directly; one without (written before Initiatives had a Space)
 *  is placed by the caller's fallback. */
export function inSpace(s: { activity_space_id?: string | null }, spaceId: string | null, fallback: () => boolean): boolean {
  return s.activity_space_id ? s.activity_space_id === spaceId : fallback();
}

/** Initiatives that belong on this Space's pages: those whose Space it is.
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
   *  Initiative with two parents appears twice. */
  key: string;
  children: InitiativeNode<T>[];
}

/** The Initiative tree in display order (siblings oldest first). The roots
 *  are the Initiatives with no parent in the list. A link that would close
 *  a loop is not followed, and an Initiative the roots never reach (one
 *  caught in a loop) is lifted to the top — every Initiative appears. */
export function buildInitiativeTree<T extends InitiativeMember>(initiatives: T[]): InitiativeNode<T>[] {
  const ids = new Set(initiatives.map((s) => s.id));
  const sorted = [...initiatives].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.name.localeCompare(b.name));
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
