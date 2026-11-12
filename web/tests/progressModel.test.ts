import { describe, expect, it } from 'vitest';
import { buildProgressSeries, itemTimes, progressBreakdown, type ProgressItem } from '@/Function/shared/progressModel';

const NOW = Date.parse('2026-11-12T12:00:00+09:00');
const item = (over: Partial<ProgressItem>): ProgressItem => ({
  id: 'e', status: 'todo', createdAt: '2026-11-01T00:00:00+09:00', startDate: null, dueDate: null, updatedAt: null,
  assignees: [], labels: [], type: null, ...over,
});

describe('itemTimes', () => {
  it('uses the Status record when there is one', () => {
    const t = itemTimes(item({ status: 'done' }), { startedAt: '2026-11-03T00:00:00+09:00', doneAt: '2026-11-05T00:00:00+09:00' }, NOW);
    expect(t.started).toBe(Date.parse('2026-11-03T00:00:00+09:00'));
    expect(t.done).toBe(Date.parse('2026-11-05T00:00:00+09:00'));
  });
  it('falls back to the dates on the Element', () => {
    const t = itemTimes(item({ status: 'done', startDate: '2026-10-20', dueDate: '2026-10-28', createdAt: '2026-11-10T00:00:00+09:00' }), undefined, NOW);
    expect(t.scope).toBe(new Date(2026, 9, 20).getTime());
    expect(t.done).toBe(new Date(2026, 9, 28).getTime());
  });
  it('never dates anything after now, and keeps the steps in order', () => {
    const t = itemTimes(item({ status: 'done', startDate: '2026-11-20', dueDate: '2026-12-01', updatedAt: '2026-11-11T00:00:00+09:00' }), undefined, NOW);
    expect(t.started).toBeLessThanOrEqual(NOW);
    expect(t.done!).toBeGreaterThanOrEqual(t.started!);
    expect(t.done).toBeLessThanOrEqual(NOW);
  });
  it('has no started or done time for untouched work', () => {
    expect(itemTimes(item({}), undefined, NOW)).toMatchObject({ started: null, done: null });
  });
});

describe('buildProgressSeries', () => {
  const items = [
    item({ id: 'a', status: 'done', startDate: '2026-11-02', dueDate: '2026-11-04' }),
    item({ id: 'b', status: 'in_progress', startDate: '2026-11-05' }),
    item({ id: 'c', status: 'todo' }),
    item({ id: 'x', status: 'cancelled' }),
  ];
  const series = buildProgressSeries(items, new Map(), NOW, '2026-11-30');
  it('leaves cancelled work out', () => {
    expect(series.totals).toEqual({ scope: 3, started: 1, completed: 1 });
  });
  it('ends today with the totals, and never goes down', () => {
    const last = series.points.at(-1)!;
    expect(last).toMatchObject({ scope: 3, started: 2, completed: 1 });
    for (let i = 1; i < series.points.length; i++) {
      expect(series.points[i].scope).toBeGreaterThanOrEqual(series.points[i - 1].scope);
      expect(series.points[i].completed).toBeGreaterThanOrEqual(series.points[i - 1].completed);
    }
  });
  it('runs to the target date', () => {
    expect(series.t1).toBe(new Date(2026, 10, 30).getTime());
  });
  it('counts each completion in one week', () => {
    expect(series.weeks.reduce((n, w) => n + w.completed, 0)).toBe(1);
  });
});

describe('progressBreakdown', () => {
  const items = [
    item({ id: 'a', status: 'done', assignees: [{ id: 'w1', name: 'bob' }], labels: ['web'], type: 'Task' }),
    item({ id: 'b', status: 'todo', assignees: [{ id: 'w1', name: 'bob' }, { id: 'w2', name: 'jon' }], labels: [] }),
    item({ id: 'c', status: 'cancelled', assignees: [{ id: 'w2', name: 'jon' }] }),
  ];
  it('counts done of total per assignee, an Element under each of its people', () => {
    expect(progressBreakdown(items, 'assignee')).toEqual([
      { key: 'w1', label: 'bob', total: 2, done: 1 },
      { key: 'w2', label: 'jon', total: 1, done: 0 },
    ]);
  });
  it('puts work with no value last', () => {
    expect(progressBreakdown(items, 'label').map((s) => s.key)).toEqual(['web', '']);
    expect(progressBreakdown(items, 'type').at(-1)).toEqual({ key: '', label: '', total: 1, done: 0 });
  });
});
