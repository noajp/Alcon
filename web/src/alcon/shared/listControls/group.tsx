// Group + Order: ElementWithDetails[] → ListSection[].
//
// Grouping decides how elements are bucketed (one bucket per status / per
// assignee / per label …). Ordering sorts elements within each bucket.
// 'none' grouping yields a single anonymous bucket.

import { Calendar as CalendarIcon, Tag as TagIcon, User as UserIcon } from 'lucide-react';
import type { ElementPriority, ElementStatus } from '@/types/database';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ListSection } from '@/alcon/object/ObjectListView';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { ElementTypeIcon } from '@/shell/icons';
import {
  type ListDisplay,
  type ListGroupBy,
  labelForPriority,
  labelForStatus,
  priorityWeight,
} from './types';

type Bucket = { id: string; name: string; icon?: React.ReactNode; elements: ElementWithDetails[] };

// Section icons per group type — keeps the bg-muted/70 band visually
// consistent with the existing Domain / Object headers.
function iconForGroup(groupBy: ListGroupBy, bucketId: string): React.ReactNode | undefined {
  if (bucketId === '__none__') return undefined;
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

// Stable ISO week / month string for date_week / date_month buckets.
function isoWeek(date: string): string {
  // Take Monday of the ISO week containing `date`. Outputs YYYY-MM-DD.
  const d = new Date(date.slice(0, 10));
  if (Number.isNaN(d.getTime())) return 'unknown';
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}
function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function bucketize(elements: ElementWithDetails[], groupBy: ListGroupBy): Bucket[] {
  // 'none' → one anonymous bucket. 'object' has no Object partition at this
  // layer (the caller owns it — see ElementsList / MyElementsView), so it also
  // degrades to a single flat bucket rather than silently dropping every
  // element through a switch with no matching case.
  if (groupBy === 'none' || groupBy === 'object') {
    return [{ id: '__all__', name: '', elements }];
  }

  const map = new Map<string, Bucket>();
  const push = (id: string, name: string, e: ElementWithDetails) => {
    let b = map.get(id);
    if (!b) { b = { id, name, elements: [] }; map.set(id, b); }
    b.elements.push(e);
  };

  for (const e of elements) {
    switch (groupBy) {
      case 'status': {
        const k = e.status ?? '__none__';
        push(k, k === '__none__' ? 'No status' : labelForStatus(k), e);
        break;
      }
      case 'priority': {
        const k = e.priority ?? '__none__';
        push(k, k === '__none__' ? 'No priority' : labelForPriority(k), e);
        break;
      }
      case 'type': {
        const k = e.type ?? '__none__';
        push(k, k === '__none__' ? 'No type' : k, e);
        break;
      }
      case 'assignee': {
        const list = e.assignees ?? [];
        if (list.length === 0) {
          push('__none__', 'Unassigned', e);
        } else {
          // Show in every assignee's bucket — matches Linear's behaviour
          // where multi-assignee tasks appear in each person's lane.
          for (const a of list) {
            const wid = a.worker_id;
            const name = a.worker?.name ?? 'Unknown';
            push(wid, name, e);
          }
        }
        break;
      }
      case 'label': {
        if (!e.labels || e.labels.length === 0) {
          push('__none__', 'No labels', e);
        } else {
          for (const l of e.labels) push(l, l, e);
        }
        break;
      }
      case 'date_week': {
        if (!e.due_date) {
          push('__none__', 'No due date', e);
        } else {
          const k = isoWeek(e.due_date);
          push(k, `Week of ${k}`, e);
        }
        break;
      }
      case 'date_month': {
        if (!e.due_date) {
          push('__none__', 'No due date', e);
        } else {
          const k = monthKey(e.due_date);
          push(k, k, e);
        }
        break;
      }
    }
  }

  // Sort buckets themselves for stable visual order.
  const buckets = Array.from(map.values());
  buckets.sort((a, b) => {
    // "No X" always last.
    if (a.id === '__none__') return 1;
    if (b.id === '__none__') return -1;
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
    objects: [],
    elements: b.elements,
  }));
}
