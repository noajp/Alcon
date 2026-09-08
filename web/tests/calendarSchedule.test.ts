import { describe, expect, it } from 'vitest';
import { calendarEntries, occursOn, selectCalendarScope, layoutTimedEntries } from '../src/ActivitySpace/sustainment/calendar/schedule';
import type { AlconObjectWithChildren, ElementWithDetails } from '../src/types/database';

const element = (id: string) => ({ id, title: id, start_date: '2026-09-06', due_date: '2026-09-08' } as ElementWithDetails);
const object = (id: string, elements: ElementWithDetails[]) => ({ id, name: id, elements, start_date: '2026-09-01', due_date: '2026-09-30' } as AlconObjectWithChildren);

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
