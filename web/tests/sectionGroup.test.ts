import { describe, expect, it } from 'vitest';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { groupAndOrder } from '@/Function/shared/listControls/group';
import type { ListDisplay, ListGroupBy } from '@/Function/shared/listControls/types';
import {
  NO_VALUE_BUCKET,
  sectionGroupValues,
} from '@/Function/shared/listControls/sectionGroup';

// Grouping and creating are two halves of one rule: a row added under
// "In progress" has to stay under "In progress". `bucketize` decides which
// band an Element falls in; `sectionGroupValues` decides what to write so a
// new Element falls in the band the user pointed at. The invariant worth
// pinning is that the two agree — feed a section's group back through
// creation and the resulting Element must re-bucket into that same section.

const DISPLAY = (groupBy: ListGroupBy): ListDisplay => ({
  groupBy,
  orderBy: 'manual',
  orderDir: 'asc',
});

/** An Element carrying only the fields grouping reads. */
function element(e: Partial<ElementWithDetails> & { id: string }): ElementWithDetails {
  return {
    status: null, priority: null, type: null, labels: [],
    due_date: null, assignees: [], order_index: 0, title: e.id,
    ...e,
  } as ElementWithDetails;
}

/** Apply a section's inherited values to a blank Element, the way the
 *  quick-add popup's pills carry them into createElement. */
function created(id: string, values: ReturnType<typeof sectionGroupValues>): ElementWithDetails {
  return element({
    id,
    status: values.status ?? null,
    priority: values.priority ?? null,
    type: values.type ?? null,
    labels: values.labels ?? [],
    due_date: values.due_date ?? null,
    assignees: values.assigneeWorkerIds.map((worker_id) => ({
      id: `a-${worker_id}`, element_id: id, worker_id, role: 'assignee',
      assigned_at: null, worker: undefined,
    })),
  } as Partial<ElementWithDetails> & { id: string });
}

const SEED: ElementWithDetails[] = [
  element({ id: 'a', status: 'in_progress', priority: 'high', type: 'Bug', labels: ['infra'], due_date: '2026-08-27', assignees: [{ id: 'x', element_id: 'a', worker_id: 'w1', role: 'assignee', assigned_at: null, worker: undefined }] }),
  element({ id: 'b' }),
];

describe('sectionGroupValues round-trips through grouping', () => {
  const FIELDS: ListGroupBy[] = ['status', 'priority', 'type', 'label', 'assignee', 'date_week', 'date_month'];

  for (const field of FIELDS) {
    it(`puts a new Element back in the ${field} section it was created from`, () => {
      for (const section of groupAndOrder(SEED, DISPLAY(field))) {
        expect(section.group).toEqual({
          field,
          value: section.id === NO_VALUE_BUCKET ? null : section.id,
        });
        const fresh = created('new', sectionGroupValues(section.group));
        const rebucketed = groupAndOrder([fresh], DISPLAY(field));
        expect(rebucketed.map((s) => s.id)).toEqual([section.id]);
      }
    });
  }
});

describe('sectionGroupValues', () => {
  it('leaves un-grouped sections alone', () => {
    // 'none' / 'object' bands classify by nothing, so nothing is inherited —
    // the create path falls through to the column defaults.
    for (const groupBy of ['none', 'object'] as const) {
      const [section] = groupAndOrder(SEED, DISPLAY(groupBy));
      expect(section.group).toBeUndefined();
    }
    expect(sectionGroupValues(undefined)).toEqual({ assigneeWorkerIds: [] });
  });

  it('clears the field for a "no value" bucket instead of setting one', () => {
    expect(sectionGroupValues({ field: 'status', value: null }).status).toBeNull();
    expect(sectionGroupValues({ field: 'priority', value: null }).priority).toBeNull();
    expect(sectionGroupValues({ field: 'type', value: null }).type).toBeNull();
    expect(sectionGroupValues({ field: 'date_week', value: null }).due_date).toBeNull();
    expect(sectionGroupValues({ field: 'date_month', value: null }).due_date).toBeNull();
    expect(sectionGroupValues({ field: 'label', value: null }).labels).toEqual([]);
    expect(sectionGroupValues({ field: 'assignee', value: null }).assigneeWorkerIds).toEqual([]);
  });

  it('routes assignee buckets away from the column writes', () => {
    // The worker goes on through element_assignees, so nothing lands in the
    // fields spread into createElement.
    const values = sectionGroupValues({ field: 'assignee', value: 'w1' });
    expect(values).toEqual({ assigneeWorkerIds: ['w1'] });
  });

  it('turns a month bucket into the first day of that month', () => {
    expect(sectionGroupValues({ field: 'date_month', value: '2026-08' }).due_date).toBe('2026-08-01');
  });
});
