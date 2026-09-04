// Pure, structural-sharing patches over the explorer tree and over plain
// Element lists (My Elements). Every helper returns the SAME reference when
// nothing matched, and preserves the identity of every untouched element,
// object and array on the way to the change — so setQueryData sees no change
// for a no-op, and React.memo'd rows re-render only when their own entity
// moved (Linear's "one delta, one cell"). No I/O here: the delta stream and
// the optimistic writers both compose these.

import type {
  AlconObjectWithChildren,
  Element,
  ElementAssigneeWithWorker,
  ElementWithDetails,
  Subelement,
  Worker,
} from '@/types/database';

export interface ExplorerData {
  objects: AlconObjectWithChildren[];  // Top-level Objects in the active Domain
  rootElements: ElementWithDetails[];  // Domain-direct Elements (object_id IS NULL)
}

export const EMPTY_EXPLORER_DATA: ExplorerData = { objects: [], rootElements: [] };

// ---------- Element lists (the shape My Elements holds) ----------

/** Apply `fn` to the element with `id`; same list reference when absent or
 *  when `fn` returns the same element. */
function mapElementInList(
  list: ElementWithDetails[],
  id: string,
  fn: (el: ElementWithDetails) => ElementWithDetails,
): ElementWithDetails[] {
  let hit = false;
  const next = list.map((el) => {
    if (el.id !== id) return el;
    const out = fn(el);
    if (out !== el) hit = true;
    return out;
  });
  return hit ? next : list;
}

export function patchElementInList(
  list: ElementWithDetails[],
  id: string,
  patch: Partial<Element>,
): ElementWithDetails[] {
  return mapElementInList(list, id, (el) => ({ ...el, ...patch }));
}

export function removeElementFromList(list: ElementWithDetails[], id: string): ElementWithDetails[] {
  const next = list.filter((e) => e.id !== id);
  return next.length === list.length ? list : next;
}

/** Append when absent (de-duped by id). */
export function appendElementToList(list: ElementWithDetails[], el: ElementWithDetails): ElementWithDetails[] {
  return list.some((e) => e.id === el.id) ? list : [...list, el];
}

const byOrder = <T extends { order_index: number | null }>(a: T, b: T) =>
  (a.order_index ?? 0) - (b.order_index ?? 0);

/** Insert or replace a Subelement on its parent Element. */
export function upsertSubelementInList(list: ElementWithDetails[], sub: Subelement): ElementWithDetails[] {
  return mapElementInList(list, sub.element_id, (el) => {
    const subs = el.subelements ?? [];
    const at = subs.findIndex((s) => s.id === sub.id);
    const next = at === -1 ? [...subs, sub] : subs.map((s, i) => (i === at ? sub : s));
    next.sort(byOrder);
    return { ...el, subelements: next };
  });
}

/** Remove a Subelement by id from whichever Element holds it (a DELETE row
 *  carries only the primary key). */
export function removeSubelementFromList(list: ElementWithDetails[], subId: string): ElementWithDetails[] {
  let hit = false;
  const next = list.map((el) => {
    const subs = el.subelements ?? [];
    if (!subs.some((s) => s.id === subId)) return el;
    hit = true;
    return { ...el, subelements: subs.filter((s) => s.id !== subId) };
  });
  return hit ? next : list;
}

/** Insert or replace an assignment (with its Worker) on its Element. */
export function upsertAssigneeInList(
  list: ElementWithDetails[],
  assignee: ElementAssigneeWithWorker,
): ElementWithDetails[] {
  return mapElementInList(list, assignee.element_id, (el) => {
    const current = el.assignees ?? [];
    const at = current.findIndex((a) => a.id === assignee.id);
    const next = at === -1 ? [...current, assignee] : current.map((a, i) => (i === at ? assignee : a));
    return { ...el, assignees: next };
  });
}

export function removeAssigneeFromList(list: ElementWithDetails[], assigneeId: string): ElementWithDetails[] {
  let hit = false;
  const next = list.map((el) => {
    const current = el.assignees ?? [];
    if (!current.some((a) => a.id === assigneeId)) return el;
    hit = true;
    return { ...el, assignees: current.filter((a) => a.id !== assigneeId) };
  });
  return hit ? next : list;
}

/** Patch a Worker wherever it appears as an assignee's worker. */
export function patchWorkerInList(list: ElementWithDetails[], workerId: string, patch: Partial<Worker>): ElementWithDetails[] {
  let hit = false;
  const next = list.map((el) => {
    const current = el.assignees ?? [];
    if (!current.some((a) => a.worker_id === workerId)) return el;
    hit = true;
    return {
      ...el,
      assignees: current.map((a) =>
        a.worker_id === workerId && a.worker ? { ...a, worker: { ...a.worker, ...patch } } : a,
      ),
    };
  });
  return hit ? next : list;
}

// ---------- Explorer tree ----------

/** Apply a list transform to every Element list in the tree (each Object's
 *  elements + rootElements), preserving every untouched reference. */
function mapExplorerLists(
  data: ExplorerData,
  fn: (list: ElementWithDetails[]) => ElementWithDetails[],
): ExplorerData {
  let any = false;
  const objects = data.objects.map((obj) => {
    const els = obj.elements ?? [];
    const next = fn(els);
    if (next === els) return obj;
    any = true;
    return { ...obj, elements: next };
  });
  const rootElements = fn(data.rootElements);
  if (rootElements !== data.rootElements) any = true;
  return any ? { objects, rootElements } : data;
}

export function upsertSubelementInExplorer(data: ExplorerData, sub: Subelement): ExplorerData {
  return mapExplorerLists(data, (l) => upsertSubelementInList(l, sub));
}
export function removeSubelementFromExplorer(data: ExplorerData, subId: string): ExplorerData {
  return mapExplorerLists(data, (l) => removeSubelementFromList(l, subId));
}
export function upsertAssigneeInExplorer(data: ExplorerData, a: ElementAssigneeWithWorker): ExplorerData {
  return mapExplorerLists(data, (l) => upsertAssigneeInList(l, a));
}
export function removeAssigneeFromExplorer(data: ExplorerData, assigneeId: string): ExplorerData {
  return mapExplorerLists(data, (l) => removeAssigneeFromList(l, assigneeId));
}
export function patchWorkerInExplorer(data: ExplorerData, workerId: string, patch: Partial<Worker>): ExplorerData {
  return mapExplorerLists(data, (l) => patchWorkerInList(l, workerId, patch));
}

/** Patch an Object's own columns (name, colour, dates, lead…); its element
 *  list keeps its identity. Same `data` when the id is absent. */
export function patchObjectInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<AlconObjectWithChildren>,
): ExplorerData {
  let hit = false;
  const objects = data.objects.map((obj) => {
    if (obj.id !== id) return obj;
    hit = true;
    return { ...obj, ...patch, elements: obj.elements };
  });
  return hit ? { objects, rootElements: data.rootElements } : data;
}

// Structural-sharing patch: only the changed element (and the arrays / object
// on the path to it) get fresh references; every untouched element, object,
// and array keeps its identity. When the id isn't present at all, the SAME
// `data` reference is returned — so setQueryData sees no change and skips the
// notify, and React.memo'd rows skip re-render. This is what makes "1 delta =
// 1 row re-render" hold (Linear's "one delta, one cell").
export function patchElementInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<Element>,
): ExplorerData {
  let any = false;
  const patchList = (list: ElementWithDetails[]): ElementWithDetails[] => {
    let hit = false;
    const next = list.map(el => {
      if (el.id !== id) return el;
      hit = true; any = true;
      return { ...el, ...patch };
    });
    return hit ? next : list; // unchanged list keeps its reference
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    const nextEls = patchList(els);
    return nextEls === els ? obj : { ...obj, elements: nextEls };
  });
  const rootElements = patchList(data.rootElements);
  if (!any) return data; // id not in this cache → no-op, preserve identity
  return { objects, rootElements };
}

export function patchSubelementInExplorer(
  data: ExplorerData,
  id: string,
  patch: Partial<Subelement>,
): ExplorerData {
  let any = false;
  const patchEl = (el: ElementWithDetails): ElementWithDetails => {
    const subs = el.subelements ?? [];
    let hit = false;
    const nextSubs = subs.map(s => {
      if (s.id !== id) return s;
      hit = true; any = true;
      return { ...s, ...patch };
    });
    return hit ? { ...el, subelements: nextSubs } : el;
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    let objHit = false;
    const nextEls = els.map(el => {
      const next = patchEl(el);
      if (next !== el) objHit = true;
      return next;
    });
    return objHit ? { ...obj, elements: nextEls } : obj;
  });
  const rootElements = data.rootElements.map(patchEl);
  if (!any) return data;
  return { objects, rootElements };
}

// Apply a transform to the element with `id` wherever it appears (an Element
// can be multi-homed into several objects). Structural sharing: untouched
// elements/objects keep their refs; an absent id returns the same `data`.
export function mapElementInExplorer(
  data: ExplorerData,
  id: string,
  fn: (el: ElementWithDetails) => ElementWithDetails,
): ExplorerData {
  let any = false;
  const apply = (el: ElementWithDetails): ElementWithDetails => {
    if (el.id !== id) return el;
    any = true;
    return fn(el);
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    let hit = false;
    const nextEls = els.map(el => {
      const next = apply(el);
      if (next !== el) hit = true;
      return next;
    });
    return hit ? { ...obj, elements: nextEls } : obj;
  });
  const rootElements = data.rootElements.map(apply);
  if (!any) return data;
  return { objects, rootElements };
}

// Remove an element by id from every object list + rootElements. Same `data`
// ref when nothing matched.
export function removeElementFromExplorer(data: ExplorerData, id: string): ExplorerData {
  let any = false;
  const drop = (els: ElementWithDetails[]): ElementWithDetails[] => {
    const next = els.filter(e => e.id !== id);
    if (next.length !== els.length) { any = true; return next; }
    return els;
  };
  const objects = data.objects.map(obj => {
    const els = obj.elements ?? [];
    const nextEls = drop(els);
    return nextEls === els ? obj : { ...obj, elements: nextEls };
  });
  const rootElements = drop(data.rootElements);
  if (!any) return data;
  return { objects, rootElements };
}

// Insert a (temp or real) element into its scope: appended to its parent
// object's list when it has one, otherwise to rootElements. Inserts into
// every cache that contains the parent object (or always, for root). De-dups
// by id so a double-apply can't create a duplicate row.
export function insertElementIntoExplorer(data: ExplorerData, el: ElementWithDetails): ExplorerData {
  const parentId = el.objectIds?.[0] ?? el.object_id ?? null;
  const exists = (els: ElementWithDetails[]) => els.some(e => e.id === el.id);

  if (parentId) {
    let changed = false;
    const objects = data.objects.map(obj => {
      if (obj.id !== parentId) return obj;
      const els = obj.elements ?? [];
      if (exists(els)) return obj; // already there — same tree back
      changed = true;
      return { ...obj, elements: [...els, el] };
    });
    if (!changed) return data; // parent absent here, or the row already present
    return { objects, rootElements: data.rootElements };
  }

  if (exists(data.rootElements)) return data;
  return { objects: data.objects, rootElements: [...data.rootElements, el] };
}
