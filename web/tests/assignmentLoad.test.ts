// The reading the assignee menu takes before anybody is added. Two exercises
// produced it: one where the only German speaker went onto four missions and
// the board stayed quiet, and one where a medical lead's rotation out was known
// in advance and no surface could list the work that landed on those days.
//
// What is pinned here is the arithmetic that has to be right for either warning
// to be trusted — inclusive ends, an Element with no dates having no reading at
// all, capacity exactly met not counting as over, and the Element itself never
// being charged twice when the menu is reopened.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ELEMENT_HOURS,
  MAX_SPAN_DAYS,
  countsOnDay,
  daysInSpan,
  dueWhileAway,
  elementHours,
  elementSpan,
  elementsDueInSpan,
  hoursPerDay,
  readAssignment,
  type LoadElement,
} from '@/Function/shared/assignmentLoad';
import type { CapacitySpan, CapacityWorker } from '@/Function/shared/workerCapacity';

const human: CapacityWorker = { type: 'human', capacity_hours_per_day: 8 };

const el = (over: Partial<LoadElement> & { id: string }): LoadElement => ({
  start_date: null,
  due_date: null,
  estimated_hours: null,
  priority: null,
  status: null,
  ...over,
});

// Every readAssignment fixture below dates its Elements in September 2026;
// this sits safely after that so `today` never falls inside a fixture's own
// span and silently zeroes out a day the test meant to be counted.
const FAR_FUTURE = '2026-12-01';

const away = (start: string, end: string, hours = 0): CapacitySpan => ({
  start_date: start,
  end_date: end,
  capacity_hours_per_day: hours,
});

describe('countsOnDay — a closed Element stops costing today, not yesterday', () => {
  it('counts an open Element on any day', () => {
    expect(countsOnDay({ status: 'in_progress' }, '2026-09-01', '2026-09-10')).toBe(true);
    expect(countsOnDay({ status: null }, '2026-09-01', '2026-09-10')).toBe(true);
  });

  it('stops counting a done Element from today onward', () => {
    expect(countsOnDay({ status: 'done' }, '2026-09-10', '2026-09-10')).toBe(false);
    expect(countsOnDay({ status: 'done' }, '2026-09-15', '2026-09-10')).toBe(false);
    expect(countsOnDay({ status: 'cancelled' }, '2026-09-10', '2026-09-10')).toBe(false);
  });

  it('leaves yesterday alone — the chart is a record of what was actually booked', () => {
    // An Element that finished this afternoon does not rewrite this morning's
    // reading. Otherwise a Worker's load for a day already passed would keep
    // getting lighter every time something on it closed, and "how loaded was
    // last week" would depend on when it was asked rather than what happened.
    expect(countsOnDay({ status: 'done' }, '2026-09-09', '2026-09-10')).toBe(true);
    expect(countsOnDay({ status: 'cancelled' }, '2026-08-01', '2026-09-10')).toBe(true);
  });
});

describe('elementHours', () => {
  it('uses the estimate when there is one', () => {
    expect(elementHours(el({ id: 'a', estimated_hours: 12, priority: 'low' }))).toBe(12);
  });

  it('falls back to the priority guess', () => {
    expect(elementHours(el({ id: 'a', priority: 'urgent' }))).toBe(8);
  });

  it('falls back again when the priority is unset or unknown', () => {
    expect(elementHours(el({ id: 'a' }))).toBe(2);
    expect(elementHours(el({ id: 'a', priority: 'someday' }))).toBe(DEFAULT_ELEMENT_HOURS);
  });

  it('keeps a zero estimate rather than guessing over it', () => {
    expect(elementHours(el({ id: 'a', estimated_hours: 0, priority: 'urgent' }))).toBe(0);
  });
});

describe('elementSpan', () => {
  it('spans start through due', () => {
    expect(elementSpan(el({ id: 'a', start_date: '2026-09-01', due_date: '2026-09-03' })))
      .toEqual({ start: '2026-09-01', end: '2026-09-03' });
  });

  it('reads a lone due date as that one day', () => {
    expect(elementSpan(el({ id: 'a', due_date: '2026-09-03' })))
      .toEqual({ start: '2026-09-03', end: '2026-09-03' });
  });

  it('reads a lone start date as that one day', () => {
    expect(elementSpan(el({ id: 'a', start_date: '2026-09-03' })))
      .toEqual({ start: '2026-09-03', end: '2026-09-03' });
  });

  it('has no span at all when neither date is set', () => {
    expect(elementSpan(el({ id: 'a' }))).toBeNull();
  });

  it('orders a reversed pair instead of collapsing it', () => {
    expect(elementSpan(el({ id: 'a', start_date: '2026-09-05', due_date: '2026-09-02' })))
      .toEqual({ start: '2026-09-02', end: '2026-09-05' });
  });

  it('drops a time part left on a date column', () => {
    expect(elementSpan(el({ id: 'a', due_date: '2026-09-03T00:00:00Z' })))
      .toEqual({ start: '2026-09-03', end: '2026-09-03' });
  });
});

describe('daysInSpan', () => {
  it('includes both ends', () => {
    expect(daysInSpan({ start: '2026-09-05', end: '2026-09-07' }))
      .toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
  });

  it('is one day when the ends are the same day', () => {
    expect(daysInSpan({ start: '2026-09-05', end: '2026-09-05' })).toEqual(['2026-09-05']);
  });

  it('crosses a month boundary', () => {
    expect(daysInSpan({ start: '2026-08-31', end: '2026-09-02' }))
      .toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('stops rather than walking a mistyped year to its end', () => {
    expect(daysInSpan({ start: '2026-09-01', end: '9026-09-01' })).toHaveLength(MAX_SPAN_DAYS);
  });
});

describe('hoursPerDay', () => {
  it('spreads the estimate evenly across the span', () => {
    expect(hoursPerDay(el({
      id: 'a', start_date: '2026-09-01', due_date: '2026-09-04', estimated_hours: 8,
    }))).toBe(2);
  });

  it('is the whole estimate on a one-day Element', () => {
    expect(hoursPerDay(el({ id: 'a', due_date: '2026-09-01', estimated_hours: 8 }))).toBe(8);
  });

  it('is nothing at all without dates', () => {
    expect(hoursPerDay(el({ id: 'a', estimated_hours: 8 }))).toBe(0);
  });
});

describe('readAssignment', () => {
  const target = el({
    id: 'target', start_date: '2026-09-01', due_date: '2026-09-02', estimated_hours: 8,
  });

  it('has no reading for an Element with no dates', () => {
    expect(readAssignment({
      today: FAR_FUTURE, worker: human, spans: [], committed: [], element: el({ id: 'target', estimated_hours: 8 }),
    })).toBeNull();
  });

  it('is quiet when the Element fits', () => {
    const reading = readAssignment({ today: FAR_FUTURE, worker: human, spans: [], committed: [], element: target })!;
    expect(reading.perDay).toBe(4);
    expect(reading.overDays).toBe(0);
    expect(reading.awayDays).toBe(0);
    expect(reading.worstOver).toBe(0);
  });

  it('treats capacity exactly met as fitting', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [],
      committed: [el({ id: 'other', due_date: '2026-09-01', estimated_hours: 4 })],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 4 }),
    })!;
    expect(reading.overDays).toBe(0);
    expect(reading.worstOver).toBe(0);
  });

  it('reports the day one hour past capacity', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [],
      committed: [el({ id: 'other', due_date: '2026-09-01', estimated_hours: 5 })],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 4 }),
    })!;
    expect(reading.overDays).toBe(1);
    expect(reading.overDaysBefore).toBe(0);
    expect(reading.worstOver).toBe(1);
  });

  it('separates the days that were already over from the ones this Element causes', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [],
      committed: [el({ id: 'other', start_date: '2026-09-01', due_date: '2026-09-01', estimated_hours: 10 })],
      element: el({ id: 'target', start_date: '2026-09-01', due_date: '2026-09-02', estimated_hours: 20 }),
    })!;
    expect(reading.overDays).toBe(2);
    expect(reading.overDaysBefore).toBe(1);
  });

  it('ignores committed work that does not overlap the window', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [],
      committed: [el({ id: 'other', due_date: '2026-10-01', estimated_hours: 40 })],
      element: target,
    })!;
    expect(reading.overDays).toBe(0);
  });

  it('does not charge the Worker twice for the Element being assigned', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [],
      committed: [el({ id: 'target', due_date: '2026-09-01', estimated_hours: 8 })],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 8 }),
    })!;
    expect(reading.overDays).toBe(0);
  });

  it('counts the days of an absence that the window lands on, both ends included', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [away('2026-09-05', '2026-09-07')],
      committed: [],
      element: el({ id: 'target', start_date: '2026-09-04', due_date: '2026-09-08', estimated_hours: 5 }),
    })!;
    expect(reading.awayDays).toBe(3);
    expect(reading.awayRuns).toEqual([{ start: '2026-09-05', end: '2026-09-07' }]);
  });

  it('says nothing about an absence the window misses', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [away('2026-09-05', '2026-09-07')],
      committed: [],
      element: el({ id: 'target', start_date: '2026-09-01', due_date: '2026-09-04' }),
    })!;
    expect(reading.awayDays).toBe(0);
    expect(reading.awayRuns).toEqual([]);
  });

  it('keeps two absences in the same window apart', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [away('2026-09-02', '2026-09-02'), away('2026-09-05', '2026-09-06')],
      committed: [],
      element: el({ id: 'target', start_date: '2026-09-01', due_date: '2026-09-07' }),
    })!;
    expect(reading.awayRuns).toEqual([
      { start: '2026-09-02', end: '2026-09-02' },
      { start: '2026-09-05', end: '2026-09-06' },
    ]);
  });

  it('reads any work on a day with no hours as over capacity', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [away('2026-09-01', '2026-09-01')],
      committed: [],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 1 }),
    })!;
    expect(reading.overDays).toBe(1);
    expect(reading.awayDays).toBe(1);
  });

  it('measures against a part-time span rather than the standing day', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: human,
      spans: [away('2026-09-01', '2026-09-01', 4)],
      committed: [],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 6 }),
    })!;
    expect(reading.overDays).toBe(1);
    expect(reading.awayDays).toBe(0);
    expect(reading.worstOver).toBe(2);
  });

  it('gives an agent its longer standing day', () => {
    const reading = readAssignment({
      today: FAR_FUTURE, worker: { type: 'ai_agent', capacity_hours_per_day: null },
      spans: [],
      committed: [],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 12 }),
    })!;
    expect(reading.overDays).toBe(0);
  });
});

describe('dueWhileAway', () => {
  const spans = [away('2026-09-05', '2026-09-07')];

  it('finds the Elements whose due date falls inside the absence', () => {
    const found = dueWhileAway(human, spans, [
      el({ id: 'inside', due_date: '2026-09-06' }),
      el({ id: 'outside', due_date: '2026-09-08' }),
    ]);
    expect(found.map((f) => f.element.id)).toEqual(['inside']);
    expect(found[0].day).toBe('2026-09-06');
  });

  it('includes both ends of the absence', () => {
    const found = dueWhileAway(human, spans, [
      el({ id: 'first', due_date: '2026-09-05' }),
      el({ id: 'last', due_date: '2026-09-07' }),
      el({ id: 'eve', due_date: '2026-09-04' }),
    ]);
    expect(found.map((f) => f.element.id)).toEqual(['first', 'last']);
  });

  it('skips Elements with no due date, however they are scheduled', () => {
    expect(dueWhileAway(human, spans, [
      el({ id: 'undated' }),
      el({ id: 'start-only', start_date: '2026-09-06' }),
    ])).toEqual([]);
  });

  it('leaves a part-time period alone — reduced is not away', () => {
    expect(dueWhileAway(human, [away('2026-09-05', '2026-09-07', 4)], [
      el({ id: 'inside', due_date: '2026-09-06' }),
    ])).toEqual([]);
  });

  it('returns them in due order', () => {
    const found = dueWhileAway(human, spans, [
      el({ id: 'later', due_date: '2026-09-07' }),
      el({ id: 'earlier', due_date: '2026-09-05' }),
    ]);
    expect(found.map((f) => f.element.id)).toEqual(['earlier', 'later']);
  });
});

describe('elementsDueInSpan', () => {
  const period = { start_date: '2026-09-05', end_date: '2026-09-07' };

  it('takes both ends of the period', () => {
    const found = elementsDueInSpan(period, [
      el({ id: 'first', due_date: '2026-09-05' }),
      el({ id: 'middle', due_date: '2026-09-06' }),
      el({ id: 'last', due_date: '2026-09-07' }),
      el({ id: 'after', due_date: '2026-09-08' }),
    ]);
    expect(found.map((f) => f.id)).toEqual(['first', 'middle', 'last']);
  });

  it('reports a period that is reduced but not empty', () => {
    const found = elementsDueInSpan(
      { start_date: '2026-09-05', end_date: '2026-09-07' },
      [el({ id: 'inside', due_date: '2026-09-06' })],
    );
    expect(found.map((f) => f.id)).toEqual(['inside']);
  });

  it('ignores an Element that merely runs through the period', () => {
    expect(elementsDueInSpan(period, [
      el({ id: 'through', start_date: '2026-09-01', due_date: '2026-09-20' }),
    ])).toEqual([]);
  });
});

describe('readAssignment — closed committed work stops counting against future days', () => {
  it('excludes a done committed Element from a day at or after today', () => {
    const reading = readAssignment({
      today: '2026-09-01',
      worker: human,
      spans: [],
      committed: [el({ id: 'other', status: 'done', due_date: '2026-09-01', estimated_hours: 8 })],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 4 }),
    })!;
    // Without the done Element's 8h, the target's 4h alone does not tip the day.
    expect(reading.overDays).toBe(0);
  });

  it('still counts a done committed Element against a day already in the past', () => {
    const reading = readAssignment({
      // Today is the day itself: countsOnDay treats today as "later" (not yet
      // history), so a day strictly before today is what stays booked.
      today: '2026-09-02',
      worker: human,
      spans: [],
      committed: [el({ id: 'other', status: 'done', due_date: '2026-09-01', estimated_hours: 10 })],
      element: el({ id: 'target', due_date: '2026-09-01', estimated_hours: 4 }),
    })!;
    expect(reading.overDaysBefore).toBe(1);
  });
});
