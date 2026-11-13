import { describe, expect, it } from 'vitest';
import { calendarEntries, occursOn, selectCalendarScope, layoutTimedEntries, filterByWorkers, miniMonthDays, monthOf, shiftMonth, layoutWeekSpans } from '../src/ActivitySpace/calendar/schedule';
import type { ClaywareObjectWithChildren, ElementWithDetails } from '../src/types/database';

const element = (id: string) => ({ id, title: id, start_date: '2026-09-06', due_date: '2026-09-08' } as ElementWithDetails);
const object = (id: string, elements: ElementWithDetails[]) => ({ id, name: id, elements, start_date: '2026-09-01', due_date: '2026-09-30' } as ClaywareObjectWithChildren);

describe('calendar scope', () => {
  const shared = element('shared');
  const a = object('a', [element('a1'), shared]);
  const b = object('b', [element('b1'), shared]);
  const explorers = [{ objects: [a], rootElements: [element('root')] }, { objects: [b, a], rootElements: [] }];
  it('excludes unscoped roots and deduplicates multi-homed Objects and Elements', () => {
    const scope = selectCalendarScope(explorers, []);
    expect(scope.availableObjects.map(o => o.id)).toEqual(['a', 'b']);
    expect(scope.elements.map(e => e.id)).toEqual(['a1', 'shared', 'b1']);
    expect(scope.objects).toEqual([]);
  });
  it('shows only checked Objects and their Elements, and restores Domain scope when unchecked', () => {
    const scope = selectCalendarScope(explorers, ['b']);
    expect(scope.objects.map(o => o.id)).toEqual(['b']);
    expect(scope.elements.map(e => e.id)).toEqual(['b1', 'shared']);
    expect(selectCalendarScope(explorers, []).elements).toHaveLength(3);
  });
  it('does not broaden an inaccessible Object selection to the whole Domain', () => {
    expect(selectCalendarScope(explorers, ['missing']).elements).toEqual([]);
  });
  it('keeps Object and Element event identity and navigation targets distinct', () => {
    const entries = calendarEntries([shared], [object('shared', [])]);
    expect(entries.map(e => e.id)).toEqual(['shared', 'object:shared']);
    expect(entries[0].element).toBe(shared);
    expect(entries[1].object?.id).toBe('shared');
    expect(entries[1].element).toBeUndefined();
  });
});

describe('calendar intervals', () => {
  it('includes both boundary days and all intermediate days', () => {
    const range = { start_date: '2026-08-31', due_date: '2026-09-02' };
    expect(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'].map(day => occursOn(range, day))).toEqual([false, true, true, true, false]);
  });
  it('covers its own first day when the start column carries a time', () => {
    // elements.start_date is a timestamp and arrives with one; due_date does
    // not. Compared as raw strings the timestamp sorts after its own day, so
    // the Element used to be missing from the day it starts.
    const ranged = { start_date: '2026-09-12T00:00:00+00:00', due_date: '2026-09-14' };
    expect(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'].map(day => occursOn(ranged, day)))
      .toEqual([false, true, true, true, false]);
  });
  it('supports due-only and start-only dates, and leaves undated entries off the grid', () => {
    expect(occursOn({ start_date: null, due_date: '2026-09-06' }, '2026-09-06')).toBe(true);
    expect(occursOn({ start_date: '2026-09-06', due_date: null }, '2026-09-06')).toBe(true);
    expect(occursOn({ start_date: null, due_date: null }, '2026-09-06')).toBe(false);
    expect(occursOn({ start_date: '2026-09-07', due_date: '2026-09-06' }, '2026-09-06')).toBe(false);
  });
});

describe('time grid', () => {
  it('clips overnight events to each day and excludes the midnight endpoint', () => {
    const entry = calendarEntries([{ ...element('night'), start_date: '2026-09-06', due_date: '2026-09-07', start_time: '23:00:00', due_time: '01:00:00' }])[0];
    expect(layoutTimedEntries([entry], '2026-09-06')[0]).toMatchObject({ start: 1380, end: 1440 });
    expect(layoutTimedEntries([entry], '2026-09-07')[0]).toMatchObject({ start: 0, end: 60 });
    expect(layoutTimedEntries([{ ...entry, due_time: '00:00:00' }], '2026-09-07')).toEqual([]);
  });
  it('honors partial times on multi-day ranges independently', () => {
    const entry = calendarEntries([{ ...element('partial'), start_time: null, due_time: '17:00' }])[0];
    expect(layoutTimedEntries([entry], '2026-09-06')[0]).toMatchObject({ start: 0, end: 1440 });
    expect(layoutTimedEntries([entry], '2026-09-08')[0]).toMatchObject({ start: 0, end: 1020 });
    const startOnly = { ...entry, start_time: '09:00', due_time: null };
    expect(layoutTimedEntries([startOnly], '2026-09-06')[0]).toMatchObject({ start: 540, end: 1440 });
    expect(layoutTimedEntries([startOnly], '2026-09-08')[0]).toMatchObject({ start: 0, end: 1440 });
  });
  it('keeps simultaneous appointments visible and restores width after an overlap group', () => {
    const entries = calendarEntries([
      { ...element('a'), due_date: '2026-09-06', start_time: '09:00', due_time: '10:00' },
      { ...element('b'), due_date: '2026-09-06', start_time: '09:30', due_time: '10:30' },
      { ...element('c'), due_date: '2026-09-06', start_time: '11:00', due_time: '12:00' },
    ]);
    expect(layoutTimedEntries(entries, '2026-09-06').map(({ lane, columns }) => [lane, columns])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
});

describe('calendar people filter', () => {
  const assigned = (id: string, workers: string[]) => ({ id, assignees: workers.map(worker_id => ({ worker_id })) });
  const rows: { id: string; assignees?: { worker_id: string }[] }[] = [assigned('solo', ['a']), assigned('shared', ['a', 'b']), assigned('nobody', []), { id: 'unset' }];
  it('keeps everything when nobody is hidden', () => {
    expect(filterByWorkers(rows, [])).toBe(rows);
  });
  it('drops Elements whose every assignee is hidden and keeps unassigned ones', () => {
    expect(filterByWorkers(rows, ['a']).map(r => r.id)).toEqual(['shared', 'nobody', 'unset']);
    expect(filterByWorkers(rows, ['a', 'b']).map(r => r.id)).toEqual(['nobody', 'unset']);
  });
});

describe('mini month', () => {
  it('moves by whole months across a year boundary', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthOf('2026-09-15')).toBe('2026-09');
  });
  it('always fills six weeks from the preferred first weekday', () => {
    // September 2026 starts on a Tuesday.
    const sundayFirst = miniMonthDays('2026-09', 0);
    expect(sundayFirst).toHaveLength(42);
    expect(sundayFirst[0]).toBe('2026-08-30');
    expect(sundayFirst[41]).toBe('2026-10-10');
    const mondayFirst = miniMonthDays('2026-09', 1);
    expect(mondayFirst[0]).toBe('2026-08-31');
    expect(mondayFirst.indexOf('2026-09-01')).toBe(1);
  });
  it('starts a month that begins on the first weekday with no leading days', () => {
    // November 2026 starts on a Sunday.
    expect(miniMonthDays('2026-11', 0)[0]).toBe('2026-11-01');
    expect(miniMonthDays('2026-11', 1)[0]).toBe('2026-10-26');
  });
});

describe('month bands', () => {
  const week = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
  const entry = (id: string, start: string | null, due: string | null) => ({ id, title: id, start_date: start, due_date: due } as ElementWithDetails);
  const spans = (rows: ElementWithDetails[]) => layoutWeekSpans(calendarEntries(rows), week);
  it('clips a span to the week and says which edges it runs past', () => {
    const [s] = spans([entry('trip', '2026-09-10', '2026-09-22')]);
    expect([s.startCol, s.endCol, s.continuesBefore, s.continuesAfter]).toEqual([0, 6, true, true]);
  });
  it('places single days and ranges, and leaves out what is not in the week', () => {
    const out = spans([entry('a', null, '2026-09-15'), entry('b', '2026-09-18', '2026-09-19'), entry('gone', '2026-09-01', '2026-09-05'), entry('unset', null, null)]);
    expect(out.map(s => [s.entry.id, s.startCol, s.endCol])).toEqual([['a', 2, 2], ['b', 5, 6]]);
  });
  it('stacks overlapping bands into lanes and reuses a lane once it is free', () => {
    const out = spans([entry('long', '2026-09-13', '2026-09-16'), entry('short', '2026-09-14', '2026-09-14'), entry('later', '2026-09-17', '2026-09-18')]);
    const lanes = Object.fromEntries(out.map(s => [s.entry.id, s.lane]));
    expect(lanes).toEqual({ long: 0, short: 1, later: 0 });
  });
  it('gives the earlier start the upper lane, then the longer band', () => {
    const out = spans([entry('b', '2026-09-14', '2026-09-15'), entry('a', '2026-09-14', '2026-09-19'), entry('c', '2026-09-13', '2026-09-13')]);
    expect(out.map(s => s.entry.id)).toEqual(['c', 'a', 'b']);
    expect(out.map(s => s.lane)).toEqual([0, 0, 1]);
  });
  it('leaves a range whose start is after its due off the grid, as occursOn does', () => {
    expect(spans([entry('odd', '2026-09-16', '2026-09-14')])).toEqual([]);
  });
});
