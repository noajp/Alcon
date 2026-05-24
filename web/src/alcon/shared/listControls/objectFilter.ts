// Object-side counterpart to filter.ts + group.ts.
//
// Objects only carry a small subset of the fields Element filters use:
// `name`, `type`, and timestamps. ListControls hides the unused facets
// when the caller doesn't pass option lists for them, so the same UI
// shell works without exposing dead controls.

import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import type { ListDisplay, ListFilter, ListOrderBy } from './types';

export function applyObjectFilter(
  objects: AlconObjectWithChildren[],
  filter: ListFilter,
): AlconObjectWithChildren[] {
  const q = filter.query?.trim().toLowerCase() ?? '';
  return objects.filter((o) => {
    if (filter.types && filter.types.length > 0) {
      if (!o.type || !filter.types.includes(o.type)) return false;
    }
    if (q && !o.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

const SUPPORTED_OBJECT_ORDERS: ListOrderBy[] = ['manual', 'title', 'created', 'updated'];

export function orderObjects(
  objects: AlconObjectWithChildren[],
  display: ListDisplay,
): AlconObjectWithChildren[] {
  const dir = display.orderDir === 'desc' ? -1 : 1;
  // Anything not in SUPPORTED_OBJECT_ORDERS falls back to manual.
  const ordering: ListOrderBy = SUPPORTED_OBJECT_ORDERS.includes(display.orderBy)
    ? display.orderBy
    : 'manual';
  return [...objects].sort((a, b) => {
    switch (ordering) {
      case 'manual':
        return dir * ((a.order_index ?? 0) - (b.order_index ?? 0));
      case 'title':
        return dir * a.name.localeCompare(b.name);
      case 'created':
        return dir * (a.created_at ?? '').localeCompare(b.created_at ?? '');
      case 'updated':
        return dir * (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
      default:
        return 0;
    }
  });
}
