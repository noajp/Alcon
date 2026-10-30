import { describe, expect, it } from 'vitest';
import { sortElements, sortKeyOf, type ColumnSort, type ElementLike } from '@/Function/shared/listTable/useListColumns';
import type { CustomColumnValue, CustomColumnWithValues } from '@/types/database';

// List sorting is the one piece of the table every list surface shares —
// Domain Elements, a per-Object Elements tab, My Elements. The invariants worth
// pinning are the ones a reader would not guess from the call site:
//
//   1. nulls sort last in BOTH directions (an empty cell never floats to the
//      top just because the user clicked "desc"),
//   2. a custom Property's value can arrive by either of two storage shapes,
//      and both must sort identically,
//   3. sorting never mutates the caller's array.

/** An Element as the sorter sees it: the sortable fields plus its row id. */
type Row = ElementLike & { id: string };

/** Identity, but it pins the literal to `Row` so the sorter's weak
 *  `ElementLike` parameter accepts a fixture that carries an `id`. */
function row(r: Row): Row {
  return r;
}

const idsOf = (rows: Row[]) => rows.map((r) => r.id);

/** A CustomColumnWithValues carrying only the fields sorting actually reads. */
function customColumn(
  id: string,
  values?: Record<string, CustomColumnValue>,
): CustomColumnWithValues {
  return {
    id,
    object_id: null,
    domain_id: null,
    activity_space_id: null,
    owner_user_id: null,
    name: id,
    column_type: 'text',
    options: {},
    order_index: null,
    is_visible: true,
    width: null,
    created_at: null,
    updated_at: null,
    values,
  };
}

/** A custom_column_values row holding `value` for `elementId`. */
function customValue(columnId: string, elementId: string, value: unknown): CustomColumnValue {
  return {
    id: `${columnId}:${elementId}`,
    column_id: columnId,
    element_id: elementId,
    object_id: null,
    value: value as CustomColumnValue['value'],
    created_at: null,
    updated_at: null,
  };
}

const asc = (id: string): ColumnSort => ({ id, direction: 'asc' });
const desc = (id: string): ColumnSort => ({ id, direction: 'desc' });

describe('sortKeyOf — which field each column id reads', () => {
  it('reads the built-in columns off their matching field', () => {
    const el = row({ id: 'e1', type: 'Task', due_date: '2026-01-01' });
    expect(sortKeyOf(el, asc('type'), [])).toBe('Task');
    expect(sortKeyOf(el, asc('due_date'), [])).toBe('2026-01-01');
  });

  it('reads assignee from the FIRST assignee only', () => {
    const el = row({
      id: 'e1',
      assignees: [{ worker: { name: 'Bo' } }, { worker: { name: 'Ada' } }],
    });
    expect(sortKeyOf(el, asc('assignee'), [])).toBe('Bo');
  });

  it('returns null — never undefined — for every missing built-in value', () => {
    const empty = row({ id: 'e1' });
    for (const id of ['type', 'due_date', 'assignee']) {
      expect(sortKeyOf(empty, asc(id), [])).toBeNull();
    }
    expect(sortKeyOf(row({ id: 'e1', assignees: [] }), asc('assignee'), [])).toBeNull();
    expect(
      sortKeyOf(row({ id: 'e1', assignees: [{ worker: null }] }), asc('assignee'), []),
    ).toBeNull();
  });

  it('returns null for an unknown column id, leaving the order untouched', () => {
    expect(sortKeyOf(row({ id: 'e1', type: 'Task' }), asc('nope'), [])).toBeNull();
  });
});

describe('sortKeyOf — a custom Property resolves from either storage shape', () => {
  const col = 'c1';
  const sort = asc(`cc:${col}`);

  it('prefers the value carried on the Element', () => {
    const el = row({ id: 'e1', custom_column_values: { [col]: { value: 'from-element' } } });
    const columns = [customColumn(col, { e1: customValue(col, 'e1', 'from-column') })];
    expect(sortKeyOf(el, sort, columns)).toBe('from-element');
  });

  it('falls back to the column definition’s per-element values map', () => {
    const columns = [customColumn(col, { e1: customValue(col, 'e1', 'from-column') })];
    expect(sortKeyOf(row({ id: 'e1' }), sort, columns)).toBe('from-column');
  });

  it('keeps an explicit falsy Element value instead of falling through', () => {
    // The Element-side lookup guards on `!== undefined`, so 0 / '' / false are
    // real values rather than "missing". Falling through here would sort an
    // Element whose Property is genuinely 0 in among the ones that have no
    // value at all.
    const columns = [customColumn(col, { e1: customValue(col, 'e1', 'from-column') })];
    expect(
      sortKeyOf(row({ id: 'e1', custom_column_values: { [col]: { value: 0 } } }), sort, columns),
    ).toBe(0);
    expect(
      sortKeyOf(row({ id: 'e1', custom_column_values: { [col]: { value: '' } } }), sort, columns),
    ).toBe('');
  });

  it('returns null when neither shape holds a value', () => {
    expect(sortKeyOf(row({ id: 'e1' }), sort, [])).toBeNull();
    expect(sortKeyOf(row({ id: 'e1' }), sort, [customColumn(col)])).toBeNull();
    const columns = [customColumn(col, { e1: customValue(col, 'e1', 'x') })];
    expect(sortKeyOf(row({ id: 'other' }), sort, columns)).toBeNull();
  });
});

describe('sortElements — ordering', () => {
  const els: Row[] = [
    row({ id: 'b', type: 'Bug' }),
    row({ id: 'a', type: 'Approval' }),
    row({ id: 'c', type: 'Chore' }),
  ];

  it('returns the very same array when there is no sort', () => {
    expect(sortElements(els, null, [])).toBe(els);
  });

  it('sorts strings ascending and descending', () => {
    expect(idsOf(sortElements(els, asc('type'), []))).toEqual(['a', 'b', 'c']);
    expect(idsOf(sortElements(els, desc('type'), []))).toEqual(['c', 'b', 'a']);
  });

  it('compares numeric Property values numerically, not lexically', () => {
    const col = 'n';
    const numeric: Row[] = [
      row({ id: 'ten', custom_column_values: { [col]: { value: 10 } } }),
      row({ id: 'two', custom_column_values: { [col]: { value: 2 } } }),
      row({ id: 'nine', custom_column_values: { [col]: { value: 9 } } }),
    ];
    // A lexical compare would order these 10 < 2 < 9.
    expect(idsOf(sortElements(numeric, asc(`cc:${col}`), []))).toEqual(['two', 'nine', 'ten']);
  });

  it('does not mutate the array it was given', () => {
    const input = [...els];
    const before = idsOf(input);
    sortElements(input, desc('type'), []);
    expect(idsOf(input)).toEqual(before);
  });
});

describe('sortElements — nulls sort last in both directions', () => {
  const withGaps: Row[] = [
    row({ id: 'none1', type: null }),
    row({ id: 'b', type: 'Bug' }),
    row({ id: 'none2' }),
    row({ id: 'a', type: 'Approval' }),
  ];

  it('keeps missing values at the bottom ascending', () => {
    expect(idsOf(sortElements(withGaps, asc('type'), []))).toEqual(['a', 'b', 'none1', 'none2']);
  });

  it('keeps missing values at the bottom descending too', () => {
    expect(idsOf(sortElements(withGaps, desc('type'), []))).toEqual(['b', 'a', 'none1', 'none2']);
  });

  it('leaves an all-null column in its natural order', () => {
    const allNull: Row[] = [row({ id: 'x' }), row({ id: 'y' }), row({ id: 'z' })];
    expect(idsOf(sortElements(allNull, desc('type'), []))).toEqual(['x', 'y', 'z']);
  });
});

// Ordering previously read updated_at outside the column sorter. The unified
// control must keep that option functional in both directions, with nulls last.
describe('Updated ordering', () => {
  it('orders timestamps in both directions without promoting empty dates', () => {
    const rows = [row({ id: 'empty', updated_at: null }), row({ id: 'new', updated_at: '2026-09-15T00:00:00Z' }), row({ id: 'old', updated_at: '2026-09-01T00:00:00Z' })];
    expect(idsOf(sortElements(rows, asc('updated_at'), []))).toEqual(['old', 'new', 'empty']);
    expect(idsOf(sortElements(rows, desc('updated_at'), []))).toEqual(['new', 'old', 'empty']);
  });
});
