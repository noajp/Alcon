import { describe, it, expect } from 'vitest';
import { countCompletedSince, latestDoneAt } from '../src/Function/shared/completion';
import { addDays, startOfDay } from '../src/Function/shared/dateUtils';

const status = (element_id: string, detail: string, created_at: string) =>
  ({ element_id, kind: 'status', detail, created_at });

describe('latestDoneAt', () => {
  it('reads the move into done from the trigger row, ignoring other moves and kinds', () => {
    const map = latestDoneAt([
      status('a', 'in_progress → done', '2026-11-01T10:00:00Z'),
      status('b', 'done → todo', '2026-11-01T10:00:00Z'),
      { element_id: 'c', kind: 'renamed', detail: 'Renamed → done', created_at: '2026-11-01T10:00:00Z' },
    ]);
    expect([...map.entries()]).toEqual([['a', '2026-11-01T10:00:00Z']]);
  });

  it('keeps the latest move into done when an Element was reopened and done again', () => {
    const map = latestDoneAt([
      status('a', 'todo → done', '2026-10-01T10:00:00Z'),
      status('a', 'review → done', '2026-11-01T10:00:00Z'),
      status('a', '— → done', '2026-09-01T10:00:00Z'),
    ]);
    expect(map.get('a')).toBe('2026-11-01T10:00:00Z');
  });
});

describe('countCompletedSince — the KPI "done in the last 14 days"', () => {
  const now = new Date(2026, 10, 2, 15, 0);
  const since = addDays(startOfDay(now), -13);

  it('counts an Element done today even when its due date is next month', () => {
    const els = [{ id: 'a', status: 'done', due_date: '2026-12-20' }];
    const doneAt = new Map([['a', new Date(2026, 10, 2, 9, 0).toISOString()]]);
    expect(countCompletedSince(els, doneAt, since)).toBe(1);
  });

  it('leaves out an Element done 30 days ago', () => {
    const els = [{ id: 'a', status: 'done' }];
    const doneAt = new Map([['a', addDays(now, -30).toISOString()]]);
    expect(countCompletedSince(els, doneAt, since)).toBe(0);
  });

  it('counts a done Element with no due date by its completion day', () => {
    const els = [{ id: 'a', status: 'done', due_date: null }];
    const doneAt = new Map([['a', addDays(now, -3).toISOString()]]);
    expect(countCompletedSince(els, doneAt, since)).toBe(1);
  });

  it('includes the first day of the window and excludes the day before it', () => {
    const els = [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }];
    const doneAt = new Map([
      ['a', since.toISOString()],
      ['b', new Date(since.getTime() - 1).toISOString()],
    ]);
    expect(countCompletedSince(els, doneAt, since)).toBe(1);
  });

  it('does not count an Element reopened since, or one whose completion was never recorded', () => {
    const els = [{ id: 'a', status: 'todo' }, { id: 'b', status: 'done' }];
    const doneAt = new Map([['a', now.toISOString()]]);
    expect(countCompletedSince(els, doneAt, since)).toBe(0);
  });
});
