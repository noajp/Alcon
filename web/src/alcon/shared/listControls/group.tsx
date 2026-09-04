// Group + Order: ElementWithDetails[] → ListSection[].
//
// Grouping decides how elements are bucketed (one bucket per status / per
// assignee / per label …). Ordering sorts elements within each bucket.
// 'none' grouping yields a single anonymous bucket.

import { Calendar as CalendarIcon, Tag as TagIcon, User as UserIcon } from 'lucide-react';
import type { ElementPriority, ElementStatus } from '@/types/database';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ListSection } from '@/alcon/object/ListTable';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { ElementTypeIcon } from '@/shell/icons';
import {
  type ListDisplay,
  type ListGroupBy,
  type ListControlsState,
  priorityWeight,
} from './types';
import { bucketsOf } from '@/alcon/shared/dimensions';
import { applyFilter } from './filter';
import { effectiveGroupBy } from './autoGroup';
import { NO_VALUE_BUCKET, type SectionGroup, type SectionGroupField } from './sectionGroup';

type Bucket = { id: string; name: string; icon?: React.ReactNode; elements: ElementWithDetails[] };

// Section icons per group type — keeps the bg-muted/70 band visually
// consistent with the existing Domain / Object headers.
function iconForGroup(groupBy: ListGroupBy, bucketId: string): React.ReactNode | undefined {
  if (bucketId === NO_VALUE_BUCKET) return undefined;
  switch (groupBy) {
    case 'status':
      return <ElementProgressMark status={bucketId as ElementStatus} size={14} />;
    case 'priority':
      return <PriorityMark priority={bucketId as ElementPriority} />;
    case 'assignee':
      return <UserIcon size={14} />;
    case 'type':
      return <ElementTypeIcon size={14} />;
    case 'label':
      return <TagIcon size={14} />;
    case 'date_week':
    case 'date_month':
      return <CalendarIcon size={14} />;
    default:
      return undefined;
  }
}

function bucketize(elements: ElementWithDetails[], groupBy: ListGroupBy): Bucket[] {
  // 'none' → one anonymous bucket. 'object' has no Object partition at this
  // layer (the caller owns it — see ElementsList / MyElementsView), so it also
  // degrades to a single flat bucket rather than silently dropping every
  // element through a switch with no matching case. `bucketsOf` CAN bucket by
  // Object — the widgets use that — but doing it here would double a
  // partition the list already made.
  if (groupBy === 'none' || groupBy === 'object') {
    return [{ id: '__all__', name: '', elements }];
  }

  // The mapping itself lives in `alcon/shared/dimensions` so the list and the
  // widgets bucket by the same rules. Everything below is the list's own
  // concern: its icons, and the order sections appear in.
  const map = new Map<string, Bucket>();
  for (const e of elements) {
    for (const b of bucketsOf(e, groupBy, {})) {
      let bucket = map.get(b.id);
      if (!bucket) {
        bucket = { id: b.id, name: b.label, elements: [] };
        map.set(b.id, bucket);
      }
      bucket.elements.push(e);
    }
  }

  // Sort buckets themselves for stable visual order.
  const buckets = Array.from(map.values());
  buckets.sort((a, b) => {
    // "No X" always last.
    if (a.id === NO_VALUE_BUCKET) return 1;
    if (b.id === NO_VALUE_BUCKET) return -1;
    if (groupBy === 'status') {
      const order = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'cancelled'];
      return order.indexOf(a.id) - order.indexOf(b.id);
    }
    if (groupBy === 'priority') {
      const order = ['urgent', 'high', 'medium', 'low'];
      return order.indexOf(a.id) - order.indexOf(b.id);
    }
    return a.name.localeCompare(b.name);
  });
  return buckets;
}

function compareElements(a: ElementWithDetails, b: ElementWithDetails, display: ListDisplay): number {
  const dir = display.orderDir === 'desc' ? -1 : 1;
  switch (display.orderBy) {
    case 'manual':
      return dir * ((a.order_index ?? 0) - (b.order_index ?? 0));
    case 'priority': {
      // Priority defaults to descending feel (Urgent first), so we flip the
      // direction here: 'asc' → low→urgent, 'desc' → urgent→low.
      return -dir * (priorityWeight(a.priority) - priorityWeight(b.priority));
    }
    case 'due': {
      const av = a.due_date ?? '';
      const bv = b.due_date ?? '';
      // Push nulls/empties to the end regardless of direction.
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      if (!av && !bv) return 0;
      return dir * av.localeCompare(bv);
    }
    case 'created':
      return dir * (a.created_at ?? '').localeCompare(b.created_at ?? '');
    case 'updated':
      return dir * (a.updated_at ?? '').localeCompare(b.updated_at ?? '');
    case 'title':
      return dir * a.title.localeCompare(b.title);
  }
}

// Order a flat element list per the display's orderBy/orderDir. Used by the
// 'object' grouping path, which keeps the caller's per-Object partition but
// still wants the chosen ordering applied within each Object band.
export function orderElements(
  elements: ElementWithDetails[],
  display: ListDisplay,
): ElementWithDetails[] {
  return [...elements].sort((a, b) => compareElements(a, b, display));
}

export function groupAndOrder(
  elements: ElementWithDetails[],
  display: ListDisplay,
): ListSection[] {
  const buckets = bucketize(elements, display.groupBy);
  for (const b of buckets) {
    b.elements.sort((x, y) => compareElements(x, y, display));
  }
  return buckets.map((b) => ({
    id: b.id,
    name: b.name,
    icon: iconForGroup(display.groupBy, b.id),
    group: groupOfBucket(display.groupBy, b.id),
    objects: [],
    elements: b.elements,
  }));
}

// What a bucket classifies by, travelling with the section so the add paths
// can put a new Element in the band the user pointed at. 'none' / 'object'
// bucket into one placeholder band that carries no Element value, so they
// stamp nothing.
function groupOfBucket(groupBy: ListGroupBy, bucketId: string): SectionGroup | undefined {
  if (groupBy === 'none' || groupBy === 'object') return undefined;
  return {
    field: groupBy satisfies SectionGroupField,
    value: bucketId === NO_VALUE_BUCKET ? null : bucketId,
  };
}

// Single source of truth for turning a list's controls into rendered
// sections. Used by every Element surface (list table AND the Gantt) so
// filter / group / sort behave identically across views. Three shapes:
//   - 'object'  → keep the caller's per-Object partition, filter + order
//                 within each band (falls back to one flat band if no
//                 partition, e.g. My Elements).
//   - 'none'    → one flat anonymous band, Object grouping discarded.
//   - any field → flatten then re-bucket by the chosen field.
export function buildSections(
  elements: ElementWithDetails[],
  objectSections: ListSection[] | undefined,
  controls: ListControlsState,
  currentUserId: string | null,
  blockedElementIds?: ReadonlySet<string>,
): ListSection[] {
  const opts = { currentUserId, blockedElementIds };
  const effGroupBy = effectiveGroupBy(controls.filter, controls.display.groupBy);
  if (effGroupBy === 'object') {
    if (objectSections && objectSections.length > 0) {
      const out: ListSection[] = [];
      for (const sec of objectSections) {
        const els = applyFilter(sec.elements ?? [], controls.filter, opts);
        if (els.length === 0) continue;
        out.push({ ...sec, elements: orderElements(els, controls.display) });
      }
      return out;
    }
    const filtered = applyFilter(elements, controls.filter, opts);
    if (filtered.length === 0) return [];
    return [{ id: '_all', name: '', objects: [], elements: orderElements(filtered, controls.display) }];
  }
  if (effGroupBy === 'none') {
    const filtered = applyFilter(elements, controls.filter, opts);
    if (filtered.length === 0) return [];
    return [{ id: '_all', name: '', objects: [], elements: orderElements(filtered, controls.display) }];
  }
  const filtered = applyFilter(elements, controls.filter, opts);
  return groupAndOrder(filtered, { ...controls.display, groupBy: effGroupBy });
}
