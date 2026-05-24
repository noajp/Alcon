// Pure filter: ElementWithDetails[] → ElementWithDetails[].
//
// Every branch is OR within a single field (e.g. status in ['todo','done'])
// and AND across fields (status matches AND priority matches AND …). An
// undefined / empty field is a no-op (no constraint).

import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ListFilter } from './types';

const includes = <T>(set: T[] | undefined, value: T | null | undefined): boolean => {
  if (!set || set.length === 0) return true; // unconstrained
  if (value == null) return false;            // null can't match a positive list
  return set.includes(value);
};

const intersects = <T>(set: T[] | undefined, values: T[] | undefined): boolean => {
  if (!set || set.length === 0) return true;
  if (!values || values.length === 0) return false;
  for (const v of values) if (set.includes(v)) return true;
  return false;
};

const isClosed = (e: ElementWithDetails): boolean =>
  e.status === 'done' || e.status === 'cancelled';

const matchesDateRange = (
  due: string | null,
  from: string | null | undefined,
  to: string | null | undefined,
): boolean => {
  // No range set → match. Element with no due_date → matches only when
  // there's no constraint (so a "show items due this week" filter excludes
  // undated items, which is the expected behaviour).
  if (!from && !to) return true;
  if (!due) return false;
  const d = due.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

export function applyFilter(
  elements: ElementWithDetails[],
  filter: ListFilter,
  options?: { currentUserId?: string | null },
): ElementWithDetails[] {
  const me = options?.currentUserId ?? null;
  const q = filter.query?.trim().toLowerCase() ?? '';

  return elements.filter((e) => {
    if (!filter.includeClosed && isClosed(e)) return false;
    if (!includes(filter.status,   e.status))   return false;
    if (!includes(filter.priority, e.priority)) return false;
    if (!includes(filter.types,    e.type))     return false;
    if (!intersects(filter.labels, e.labels))   return false;

    if (filter.assigneeWorkerIds && filter.assigneeWorkerIds.length > 0) {
      const assigneeIds = (e.assignees ?? []).map((a) => a.worker_id);
      let hit = false;
      for (const id of filter.assigneeWorkerIds) {
        if (assigneeIds.includes(id)) { hit = true; break; }
      }
      if (!hit) return false;
    }

    if (filter.ownerOnly) {
      if (!me) return false;
      if (e.owner_id !== me) return false;
    }

    if (filter.objectIds && filter.objectIds.length > 0) {
      if (!e.object_id || !filter.objectIds.includes(e.object_id)) return false;
    }

    if (!matchesDateRange(e.due_date, filter.dueFrom, filter.dueTo)) return false;

    if (q && !e.title.toLowerCase().includes(q)) return false;

    return true;
  });
}
