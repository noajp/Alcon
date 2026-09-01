import { describe, expect, it } from 'vitest';
import {
  countShaken,
  evaluateAssumption,
  evaluateWatch,
  isAssumption,
  orderAssumptions,
  shakenLabel,
  watchLabel,
  type AssumptionInput,
  type WatchInput,
} from '@/alcon/element/actions/campaignAssumptionModel';

// The whole point of the assumptions surface is one claim: "something this
// assumption depends on has stopped moving". Everything below tests that claim
// and the two ways it can be wrong — a false alarm (a finished Element with an
// old due date, a cancelled blocker) and a missed one (a late Element that
// nobody has touched).
//
// `now` is an argument to every function under test, so nothing here waits for
// a date to pass.

const NOW = new Date(2026, 8, 1, 10, 30); // 2026-09-01, local, mid-morning.

function watch(over: Partial<WatchInput> = {}): WatchInput {
  return {
    bindingId: `b-${over.elementId ?? 'x'}`,
    elementId: 'el-1',
    displayId: 'EL-1',
    title: 'Contract review',
    status: 'in_progress',
    dueDate: null,
    objectId: 'ob-1',
    domainId: 'dm-1',
    ...over,
  };
}

function assumption(over: Partial<AssumptionInput> = {}): AssumptionInput {
  return {
    id: 'a-1',
    title: 'Only one person speaks the language',
    cost: 'Entry stops',
    notedBy: 'CEO',
    notedAt: '2026-08-01T09:00:00.000Z',
    orderIndex: 1,
    watches: [],
    ...over,
  };
}

describe('isAssumption — telling the two kinds of Intent apart', () => {
  it('reads the kind column and nothing else', () => {
    expect(isAssumption('assumption')).toBe(true);
    expect(isAssumption('decision')).toBe(false);
    // The Campaign's root Intent is a spine, not a row either surface lists.
    expect(isAssumption('master')).toBe(false);
    // A row written before the column existed reads as null until migrated.
    expect(isAssumption(null)).toBe(false);
    expect(isAssumption(undefined)).toBe(false);
  });
});

describe('evaluateWatch — one Element, read for a signal', () => {
  it('reports nothing for an Element that is moving and not late', () => {
    const w = evaluateWatch(watch({ dueDate: '2026-09-30' }), NOW);
    expect(w.blocked).toBe(false);
    expect(w.overdue).toBe(false);
    expect(w.daysOverdue).toBe(null);
    expect(watchLabel(w)).toBe(null);
  });

  it('reports blocked', () => {
    const w = evaluateWatch(watch({ status: 'blocked' }), NOW);
    expect(w.blocked).toBe(true);
    expect(watchLabel(w)).toBe('Blocked');
  });

  it('counts overdue in whole calendar days, not elapsed hours', () => {
    // Due yesterday, read at 10:30 today: one day, not zero and not two.
    const w = evaluateWatch(watch({ dueDate: '2026-08-31' }), NOW);
    expect(w.overdue).toBe(true);
    expect(w.daysOverdue).toBe(1);
    expect(watchLabel(w)).toBe('1d overdue');
  });

  it('does not call a date due today overdue', () => {
    const w = evaluateWatch(watch({ dueDate: '2026-09-01' }), NOW);
    expect(w.overdue).toBe(false);
  });

  it('reads the due date as a calendar day, not a UTC instant', () => {
    // `new Date('2026-08-31')` is UTC midnight, which is the 30th west of
    // Greenwich — the bug this parses around. Yesterday is 1 day past here
    // regardless of the reader's offset.
    expect(evaluateWatch(watch({ dueDate: '2026-08-31' }), NOW).daysOverdue).toBe(1);
    expect(evaluateWatch(watch({ dueDate: '2026-08-25' }), NOW).daysOverdue).toBe(7);
  });

  it('says nothing about a closed Element', () => {
    // A finished Element with a date three weeks gone is not a late Element,
    // and a cancelled one cannot block anything. Both would otherwise raise a
    // mark on an assumption that is perfectly intact.
    for (const status of ['done', 'cancelled']) {
      const w = evaluateWatch(watch({ status, dueDate: '2026-08-10' }), NOW);
      expect(w.overdue).toBe(false);
      expect(w.blocked).toBe(false);
      expect(watchLabel(w)).toBe(null);
    }
  });

  it('keeps both signals when an Element is blocked and late', () => {
    const w = evaluateWatch(watch({ status: 'blocked', dueDate: '2026-08-29' }), NOW);
    expect(w.blocked).toBe(true);
    expect(w.overdue).toBe(true);
    expect(w.daysOverdue).toBe(3);
    // The chip has room for one, and being stopped outranks being late.
    expect(watchLabel(w)).toBe('Blocked');
  });

  it('reports nothing for an Element with no due date', () => {
    const w = evaluateWatch(watch({ dueDate: null }), NOW);
    expect(w.overdue).toBe(false);
    expect(w.daysOverdue).toBe(null);
  });

  it('treats an unparseable due date as no date rather than as overdue', () => {
    const w = evaluateWatch(watch({ dueDate: 'someday' }), NOW);
    expect(w.overdue).toBe(false);
  });
});

describe('evaluateAssumption — the mark on the Campaign', () => {
  it('is steady while everything it watches is moving', () => {
    const a = evaluateAssumption(
      assumption({ watches: [watch({ elementId: 'e1' }), watch({ elementId: 'e2' })] }),
      NOW,
    );
    expect(a.shaken).toBe(false);
    expect(a.unwatched).toBe(false);
    expect(shakenLabel(a)).toBe('');
  });

  it('is shaken when one watched Element is blocked', () => {
    const a = evaluateAssumption(
      assumption({
        watches: [watch({ elementId: 'e1' }), watch({ elementId: 'e2', status: 'blocked' })],
      }),
      NOW,
    );
    expect(a.shaken).toBe(true);
    expect(a.blocked).toBe(1);
    expect(a.overdue).toBe(0);
    expect(shakenLabel(a)).toBe('1 blocked');
  });

  it('names both readings when they fire together', () => {
    const a = evaluateAssumption(
      assumption({
        watches: [
          watch({ elementId: 'e1', status: 'blocked' }),
          watch({ elementId: 'e2', dueDate: '2026-08-20' }),
        ],
      }),
      NOW,
    );
    expect(shakenLabel(a)).toBe('1 blocked, 1 overdue');
  });

  it('counts one Element once per reading, not once overall', () => {
    const a = evaluateAssumption(
      assumption({ watches: [watch({ elementId: 'e1', status: 'blocked', dueDate: '2026-08-20' })] }),
      NOW,
    );
    expect(a.blocked).toBe(1);
    expect(a.overdue).toBe(1);
    expect(a.watches).toHaveLength(1);
  });

  it('reports an assumption nothing is watching, and does not call it shaken', () => {
    // The two are different problems. Nothing has broken; nothing *can* be
    // observed to break, which is worth saying and is not an alarm.
    const a = evaluateAssumption(assumption({ watches: [] }), NOW);
    expect(a.unwatched).toBe(true);
    expect(a.shaken).toBe(false);
  });

  it('is not shaken by an Element that was finished late', () => {
    const a = evaluateAssumption(
      assumption({ watches: [watch({ status: 'done', dueDate: '2026-07-01' })] }),
      NOW,
    );
    expect(a.shaken).toBe(false);
  });
});

describe('orderAssumptions — shaken first', () => {
  it('lifts the shaken above the steady regardless of when they were noted', () => {
    const rows = orderAssumptions(
      [
        assumption({ id: 'steady', notedAt: '2026-08-30T00:00:00.000Z' }),
        assumption({
          id: 'shaken',
          notedAt: '2026-06-01T00:00:00.000Z',
          watches: [watch({ status: 'blocked' })],
        }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['shaken', 'steady']);
  });

  it('puts the worse-hit assumption first inside the shaken band', () => {
    const rows = orderAssumptions(
      [
        assumption({ id: 'one', watches: [watch({ elementId: 'a', status: 'blocked' })] }),
        assumption({
          id: 'three',
          watches: [
            watch({ elementId: 'b', status: 'blocked' }),
            watch({ elementId: 'c', dueDate: '2026-08-01' }),
            watch({ elementId: 'd', dueDate: '2026-08-02' }),
          ],
        }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['three', 'one']);
  });

  it('orders steady assumptions newest first', () => {
    const rows = orderAssumptions(
      [
        assumption({ id: 'old', notedAt: '2026-01-01T00:00:00.000Z' }),
        assumption({ id: 'new', notedAt: '2026-08-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('sinks undated assumptions rather than floating them to the top', () => {
    const rows = orderAssumptions(
      [
        assumption({ id: 'undated', notedAt: null }),
        assumption({ id: 'dated', notedAt: '2026-01-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['dated', 'undated']);
  });

  it('is stable when everything else ties', () => {
    const rows = orderAssumptions(
      [
        assumption({ id: 'b', notedAt: null, orderIndex: 1 }),
        assumption({ id: 'a', notedAt: null, orderIndex: 1 }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('counts the shaken for the section header', () => {
    const rows = orderAssumptions(
      [
        assumption({ id: '1', watches: [watch({ status: 'blocked' })] }),
        assumption({ id: '2', watches: [watch({ dueDate: '2026-08-01' })] }),
        assumption({ id: '3' }),
      ],
      NOW,
    );
    expect(countShaken(rows)).toBe(2);
  });

  it('returns nothing for nothing', () => {
    expect(orderAssumptions([], NOW)).toEqual([]);
    expect(countShaken([])).toBe(0);
  });
});
