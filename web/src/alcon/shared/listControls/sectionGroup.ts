// The inverse of `bucketize` (./group.tsx): given the bucket a section stands
// for, the Element values that put a new row inside it.
//
// Grouping and creating have to agree. A row added under "In progress"
// belongs in "In progress" — the cursor already answered "which status", so
// the create path applies the bucket's own value rather than falling back to
// the column default and bouncing the new row into a different band. Same
// rule as dragging a row between groups: the target group's property wins.

import type { ElementPriority, ElementStatus } from '@/types/database';
import type { ListGroupBy } from './types';

/** Bucket id for the band holding everything the grouping field is empty on —
 *  "No status", "Unassigned", "No due date". Creating from it clears the
 *  field instead of setting one. */
export const NO_VALUE_BUCKET = '__none__';

/** A grouping field that partitions by a value Elements actually carry.
 *  'none' and 'object' are excluded: they yield a single band whose id is a
 *  placeholder, so there is nothing for a new Element to inherit. */
export type SectionGroupField = Exclude<ListGroupBy, 'none' | 'object'>;

/** What a section's band classifies by. Carried on ListSection so an add row
 *  can read the bucket back off the section it sits in. */
export interface SectionGroup {
  field: SectionGroupField;
  /** The bucket key `bucketize` produced — a status, a worker id, a label, an
   *  ISO-week Monday … `null` for the NO_VALUE_BUCKET band. */
  value: string | null;
}

/** Fields to write so a new Element lands in the section's bucket. A key is
 *  present only when the grouping field owns it; `null` (or an empty array)
 *  means the bucket is the "no value" one and the field must be cleared. */
export interface SectionGroupValues {
  status?: ElementStatus | null;
  priority?: ElementPriority | null;
  type?: string | null;
  due_date?: string | null;
  labels?: string[];
  /** Assignee buckets aren't a column — the worker goes on through
   *  `element_assignees` after the insert. Empty for every other field, and
   *  for the "Unassigned" bucket. */
  assigneeWorkerIds: string[];
}

export function sectionGroupValues(group: SectionGroup | undefined): SectionGroupValues {
  if (!group) return { assigneeWorkerIds: [] };
  const { value } = group;
  switch (group.field) {
    case 'status':
      return { status: value as ElementStatus | null, assigneeWorkerIds: [] };
    case 'priority':
      return { priority: value as ElementPriority | null, assigneeWorkerIds: [] };
    case 'type':
      return { type: value, assigneeWorkerIds: [] };
    case 'label':
      return { labels: value ? [value] : [], assigneeWorkerIds: [] };
    case 'assignee':
      return { assigneeWorkerIds: value ? [value] : [] };
    case 'date_week':
      // The key IS the week's Monday, so it round-trips through isoWeek()
      // back into this same band.
      return { due_date: value, assigneeWorkerIds: [] };
    case 'date_month':
      // The key is YYYY-MM; the 1st is the earliest date inside it.
      return { due_date: value ? `${value}-01` : null, assigneeWorkerIds: [] };
  }
}
