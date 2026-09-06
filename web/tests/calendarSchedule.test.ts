import { describe, expect, it } from 'vitest';
import { calendarEntries, occursOn, selectCalendarScope } from '../src/alcon/element/calendar/schedule';
import type { AlconObjectWithChildren, ElementWithDetails } from '../src/types/database';

const element = (id: string) => ({ id, title: id, start_date: '2026-09-06', due_date: '2026-09-08' } as ElementWithDetails);
const object = (id: string, elements: ElementWithDetails[]) => ({ id, name: id, elements, start_date: '2026-09-01', due_date: '2026-09-30' } as AlconObjectWithChildren);

describe('calendar scope', () => {
  const shared = element('shared');
  const a = object('a', [element('a1'), shared]);
  const b = object('b', [element('b1'), shared]);
  const explorers = [{ objects: [a], rootElements: [element('root')] }, { objects: [b, a], rootElements: [] }];
  it('includes Domain-direct Elements and deduplicates multi-homed Objects and Elements', () => {
    const scope = selectCalendarScope(explorers, []);
    expect(scope.availableObjects.map(o => o.id)).toEqual(['a', 'b']);
    expect(scope.elements.map(e => e.id)).toEqual(['root', 'a1', 'shared', 'b1']);
    expect(scope.objects).toEqual([]);
  });
  it('shows only checked Objects and their Elements, and restores Domain scope when unchecked', () => {
    const scope = selectCalendarScope(explorers, ['b']);
    expect(scope.objects.map(o => o.id)).toEqual(['b']);
    expect(scope.elements.map(e => e.id)).toEqual(['b1', 'shared']);
    expect(selectCalendarScope(explorers, []).elements).toHaveLength(4);
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
  it('supports due-only and start-only dates, and leaves undated entries off the grid', () => {
    expect(occursOn({ start_date: null, due_date: '2026-09-06' }, '2026-09-06')).toBe(true);
    expect(occursOn({ start_date: '2026-09-06', due_date: null }, '2026-09-06')).toBe(true);
    expect(occursOn({ start_date: null, due_date: null }, '2026-09-06')).toBe(false);
    expect(occursOn({ start_date: '2026-09-07', due_date: '2026-09-06' }, '2026-09-06')).toBe(false);
  });
});

describe('time grid', () => {
  it('clips overnight events to each day and excludes the midnight endpoint', async () => {
    const { timeWindow } = await import('../src/alcon/element/calendar/schedule');
    const entry = calendarEntries([{ ...element('night'), start_date: '2026-09-06', due_date: '2026-09-07', start_time: '23:00:00', due_time: '01:00:00' }])[0];
    expect(timeWindow(entry, '2026-09-06')).toEqual({ start: 1380, end: 1440 });
    expect(timeWindow(entry, '2026-09-07')).toEqual({ start: 0, end: 60 });
    expect(timeWindow({ ...entry, due_time: '00:00:00' }, '2026-09-07')).toBeNull();
  });
  it('keeps simultaneous appointments visible and restores width after an overlap group', async () => {
    const { layoutTimedEntries } = await import('../src/alcon/element/calendar/schedule');
    const entries = calendarEntries([
      { ...element('a'), due_date: '2026-09-06', start_time: '09:00', due_time: '10:00' },
      { ...element('b'), due_date: '2026-09-06', start_time: '09:30', due_time: '10:30' },
      { ...element('c'), due_date: '2026-09-06', start_time: '11:00', due_time: '12:00' },
    ]);
    expect(layoutTimedEntries(entries, '2026-09-06').map(({ lane, columns }) => [lane, columns])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
});
