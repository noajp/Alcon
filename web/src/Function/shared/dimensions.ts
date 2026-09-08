// =============================================================
// The one vocabulary for "put this Element in a bucket".
//
// A list groups by status. A bar chart breaks down by status. A flow's first
// column IS status. These are one operation asked three times, and until now
// only the list could do it — the charts each had their own axis welded in, so
// "count by priority" and "count by status" were two widgets and "count by
// label" was not possible at all.
//
// So the mapping lives here, once, pure. `group.tsx` reads it for the list's
// sections and keeps its own icons and ordering; the widgets read it to build
// whatever figure they draw. A dimension added here is available to every
// surface on the same day, which is the whole reason for the move.
//
// Multi-valued dimensions are the interesting ones. An Element with two
// assignees belongs in both people's buckets — Linear's behaviour, and the
// only reading that makes "where are the people" answerable. Callers that
// need a total must therefore count buckets, not Elements, and say which.
//
// Pure on purpose: no React, no Supabase, no clock — `now` never enters,
// because a bucket is a property of the row, not of when you looked.
// =============================================================

import type { ElementWithDetails } from '@/types/database';
import { PRIORITY, SEMANTIC_COLORS, STATUS, statusLabel } from '@/shared/designTokens';
import { holderLabel } from '@/ActivitySpace/execution/element/lease';

/**
 * Every way an Element can be put into categories.
 *
 * The first seven are `ListGroupBy` minus `none` — the same words the Display
 * menu already shows, so a dimension picker teaches nothing new. `object` and
 * `initiative` are new here: the list partitions by Object at a higher layer and
 * never needed them as buckets, but a figure does.
 */
export type Dimension =
  | 'status'
  | 'priority'
  | 'assignee'
  | 'type'
  | 'label'
  | 'date_week'
  | 'date_month'
  | 'object'
  // Stored verbatim in WidgetInstance.params (a saved widget's chosen axis),
  // so the value stays 'campaign' even though the product now calls the
  // concept "Initiative" everywhere else — renaming it would silently
  // invalidate every board that already picked this axis.
  | 'campaign'
  // Who holds the lease (elements.claimed_by, el_TRJ-012). Bucketed by the
  // token as stored, expired or not: this file has no clock on purpose — a
  // bucket is a property of the row — so "is it still live" is answered by
  // the row chip and the Properties rail (ActivitySpace/execution/element/lease.ts), not here.
  | 'holder';

export const DIMENSIONS: Dimension[] = [
  'status',
  'priority',
  'assignee',
  'object',
  'campaign',
  'holder',
  'type',
  'label',
  'date_week',
  'date_month',
];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  object: 'Object',
  campaign: 'Initiative',
  holder: 'Holder',
  type: 'Type',
  label: 'Label',
  date_week: 'Due week',
  date_month: 'Due month',
};

/** The bucket an Element lands in when it has no value for the dimension. */
export const NO_VALUE = '__none__';

const EMPTY_LABEL: Record<Dimension, string> = {
  status: 'No status',
  priority: 'No priority',
  assignee: 'Unassigned',
  object: 'No Object',
  campaign: 'No Initiative',
  holder: 'Unclaimed',
  type: 'No type',
  label: 'No labels',
  date_week: 'No due date',
  date_month: 'No due date',
};

/**
 * Names the row ids cannot supply on their own.
 *
 * `object` and `initiative` bucket by uuid, and a figure has to print something
 * a person recognises. The caller owns these because only it knows which
 * Objects and Initiatives are in scope.
 */
export interface DimensionContext {
  objectNames?: Map<string, string>;
  /** Object id → the Initiatives it feeds. */
  initiativesByObject?: Map<string, { id: string; name: string }[]>;
}

export interface DimensionBucket {
  id: string;
  label: string;
  /** A `var(--*)` string when the dimension has a meaning-carrying palette
   *  (status, priority) — null when its values are user data and a colour
   *  would be decoration. */
  color: string | null;
}

/** ISO-week Monday, as `YYYY-MM-DD`. */
function isoWeek(date: string): string {
  const d = new Date(date.slice(0, 10));
  if (Number.isNaN(d.getTime())) return 'unknown';
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

function empty(dimension: Dimension): DimensionBucket[] {
  return [{ id: NO_VALUE, label: EMPTY_LABEL[dimension], color: null }];
}

/**
 * The buckets one Element belongs to — never empty, so nothing is dropped
 * silently. An Element with no value lands in the dimension's own "no value"
 * bucket, which is a fact worth showing rather than a row to hide.
 */
export function bucketsOf(
  element: ElementWithDetails,
  dimension: Dimension,
  ctx: DimensionContext = {},
): DimensionBucket[] {
  switch (dimension) {
    case 'status': {
      const key = element.status;
      if (!key || !(key in STATUS)) return empty(dimension);
      return [{
        id: key,
        label: statusLabel(key),
        color: SEMANTIC_COLORS.status[key as keyof typeof SEMANTIC_COLORS.status] ?? null,
      }];
    }
    case 'priority': {
      const key = element.priority;
      if (!key || !(key in PRIORITY)) return empty(dimension);
      return [{
        id: key,
        label: PRIORITY[key as keyof typeof PRIORITY].label,
        color: SEMANTIC_COLORS.priority[key as keyof typeof SEMANTIC_COLORS.priority] ?? null,
      }];
    }
    case 'assignee': {
      const list = element.assignees ?? [];
      if (list.length === 0) return empty(dimension);
      return list.map((a) => ({
        id: a.worker_id,
        label: a.worker?.name ?? 'Unknown',
        color: null,
      }));
    }
    case 'type': {
      if (!element.type) return empty(dimension);
      return [{ id: element.type, label: element.type, color: null }];
    }
    case 'label': {
      const labels = element.labels ?? [];
      if (labels.length === 0) return empty(dimension);
      return labels.map((l) => ({ id: l, label: l, color: null }));
    }
    case 'date_week': {
      if (!element.due_date) return empty(dimension);
      const key = isoWeek(element.due_date);
      return [{ id: key, label: `Week of ${key}`, color: null }];
    }
    case 'date_month': {
      if (!element.due_date) return empty(dimension);
      const key = element.due_date.slice(0, 7);
      return [{ id: key, label: key, color: null }];
    }
    case 'object': {
      const id = element.object_id;
      if (!id) return empty(dimension);
      return [{ id, label: ctx.objectNames?.get(id) ?? 'Object', color: null }];
    }
    case 'campaign': {
      // An Element reaches a Initiative through its Object, so an Object in two
      // Initiatives puts its Elements in both — the same shape as two assignees.
      const owning = element.object_id
        ? ctx.initiativesByObject?.get(element.object_id) ?? []
        : [];
      if (owning.length === 0) return empty(dimension);
      return owning.map((c) => ({ id: c.id, label: c.name, color: null }));
    }
    case 'holder': {
      const token = element.claimed_by;
      if (!token) return empty(dimension);
      return [{ id: token, label: holderLabel(token), color: null }];
    }
  }
}

export interface Tallied extends DimensionBucket {
  value: number;
  elements: ElementWithDetails[];
}

/**
 * Count Elements per bucket, largest first, with the no-value bucket last.
 * Not exported: every caller wants `tallyInNaturalOrder`, which is this plus
 * the running order that `status` and `priority` carry.
 *
 * The total of the returned values can exceed the number of Elements, and
 * that is not a defect: on a multi-valued dimension an Element genuinely sits
 * in two places. Callers that print a percentage must divide by the summed
 * values, not by `elements.length`, or the parts will not make a whole.
 */
function tallyBy(
  elements: ElementWithDetails[],
  dimension: Dimension,
  ctx: DimensionContext = {},
): Tallied[] {
  const map = new Map<string, Tallied>();
  for (const element of elements) {
    for (const bucket of bucketsOf(element, dimension, ctx)) {
      const current = map.get(bucket.id);
      if (current) {
        current.value += 1;
        current.elements.push(element);
      } else {
        map.set(bucket.id, { ...bucket, value: 1, elements: [element] });
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.id === NO_VALUE) return 1;
    if (b.id === NO_VALUE) return -1;
    return b.value - a.value || a.label.localeCompare(b.label);
  });
}

/**
 * `status` and `priority` have a fixed running order that means something —
 * a backlog-to-done axis and an urgent-to-low one — and sorting those by size
 * would scramble a sequence the reader already knows.
 */
const FIXED_ORDER: Partial<Record<Dimension, string[]>> = {
  status: Object.keys(STATUS),
  priority: Object.keys(PRIORITY),
};

/** `tallyBy`, with the dimensions that have a natural sequence kept in it. */
export function tallyInNaturalOrder(
  elements: ElementWithDetails[],
  dimension: Dimension,
  ctx: DimensionContext = {},
): Tallied[] {
  const tallied = tallyBy(elements, dimension, ctx);
  const order = FIXED_ORDER[dimension];
  if (!order) return tallied;
  return [...tallied].sort((a, b) => {
    if (a.id === NO_VALUE) return 1;
    if (b.id === NO_VALUE) return -1;
    return order.indexOf(a.id) - order.indexOf(b.id);
  });
}
