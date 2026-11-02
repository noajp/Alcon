import { afterEach, describe, it, expect, vi } from 'vitest';
import { isWithinClosedWindow, needsCloseTimes, type ClosedWindowContext } from '../src/Function/shared/listControls/closedWindow';
import { applyFilter } from '../src/Function/shared/listControls/filter';
import { DEFAULT_FILTER, loadState, saveState, DEFAULT_STATE } from '../src/Function/shared/listControls/types';
import { isMoveIntoClosed, isMoveIntoDone, latestClosedAt, latestDoneAt, latestMoveInto } from '../src/Function/shared/completion';
import type { ElementWithDetails } from '../src/hooks/useSupabase';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const el = (id: string, status: string, created_at: string | null = ago(400)) => ({ id, status, created_at });
const ctx = (window: ClosedWindowContext['window'], closedAt: Record<string, string> | null = {}): ClosedWindowContext => ({
  window,
  now: NOW,
  closedAt: closedAt ? new Map(Object.entries(closedAt)) : undefined,
});

describe('isWithinClosedWindow', () => {
  it('always keeps open Elements, however old', () => {
    for (const w of ['all', 'day', 'week', 'month', 'none'] as const) {
      expect(isWithinClosedWindow(el('a', 'todo'), ctx(w))).toBe(true);
      expect(isWithinClosedWindow(el('a', 'blocked', null), ctx(w))).toBe(true);
    }
  });

  it("keeps every closed Element under 'all' and unset, and none under 'none'", () => {
    expect(isWithinClosedWindow(el('a', 'done'), ctx('all'))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done'), ctx(undefined))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done', ago(0)), ctx('none', { a: ago(0) }))).toBe(false);
    expect(isWithinClosedWindow(el('a', 'cancelled', ago(0)), ctx('none', null))).toBe(false);
  });

  it('reads the close time from the recorded move, boundary included — not the creation', () => {
    expect(isWithinClosedWindow(el('a', 'done'), ctx('day', { a: ago(0.5) }))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done'), ctx('day', { a: ago(1) }))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done'), ctx('day', { a: ago(1.01) }))).toBe(false);
    expect(isWithinClosedWindow(el('a', 'done'), ctx('week', { a: ago(6) }))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'cancelled'), ctx('week', { a: ago(8) }))).toBe(false);
    expect(isWithinClosedWindow(el('a', 'done'), ctx('month', { a: ago(29) }))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done'), ctx('month', { a: ago(31) }))).toBe(false);
  });

  it('falls back to created_at for an Element with no recorded move, and treats no timestamp as old', () => {
    expect(isWithinClosedWindow(el('a', 'done', ago(2)), ctx('week'))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done', ago(40)), ctx('month'))).toBe(false);
    expect(isWithinClosedWindow(el('a', 'done', null), ctx('month'))).toBe(false);
  });

  it('keeps closed Elements while the close times are still being read, or before the clock arrives', () => {
    expect(isWithinClosedWindow(el('a', 'done'), ctx('week', null))).toBe(true);
    expect(isWithinClosedWindow(el('a', 'done'), { ...ctx('week'), now: Number.NaN })).toBe(true);
  });

  it('needs close times only for a bounded window', () => {
    expect([undefined, 'all', 'day', 'week', 'month', 'none'].map((w) => needsCloseTimes(w as ClosedWindowContext['window'])))
      .toEqual([false, false, true, true, true, false]);
  });
});

describe('applyFilter with the closed window — the stage buildSections runs for every tab', () => {
  const rows = [el('open', 'todo'), el('recent', 'done'), el('old', 'done'), el('dropped', 'cancelled')] as unknown as ElementWithDetails[];
  const closedAt = { recent: ago(3), old: ago(20), dropped: ago(2) };

  it('drops closed Elements outside the window and keeps order', () => {
    expect(applyFilter(rows, DEFAULT_FILTER, { closedWindow: ctx('week', closedAt) }).map((e) => e.id)).toEqual(['open', 'recent', 'dropped']);
    expect(applyFilter(rows, DEFAULT_FILTER, { closedWindow: ctx('none', closedAt) }).map((e) => e.id)).toEqual(['open']);
  });

  it('leaves the rows alone without a window context', () => {
    expect(applyFilter(rows, DEFAULT_FILTER).map((e) => e.id)).toEqual(['open', 'recent', 'old', 'dropped']);
  });
});

describe('latestMoveInto', () => {
  const status = (element_id: string, detail: string, created_at: string) => ({ element_id, kind: 'status', detail, created_at });
  const rows = [
    status('a', 'todo → done', '2026-10-01T10:00:00Z'),
    status('a', 'done → todo', '2026-10-02T10:00:00Z'),
    status('b', 'in_progress → cancelled', '2026-10-03T10:00:00Z'),
    status('c', 'todo → done', '2026-10-04T10:00:00Z'),
    status('c', 'done → cancelled', '2026-10-05T10:00:00Z'),
  ];

  it('reads moves into done and into cancelled alike for the closed set', () => {
    expect(isMoveIntoClosed({ kind: 'status', detail: 'todo → cancelled' })).toBe(true);
    expect(isMoveIntoClosed({ kind: 'status', detail: 'done → todo' })).toBe(false);
    expect(isMoveIntoDone({ kind: 'status', detail: 'todo → cancelled' })).toBe(false);
    expect(Object.fromEntries(latestClosedAt(rows))).toEqual({
      a: '2026-10-01T10:00:00Z',
      b: '2026-10-03T10:00:00Z',
      c: '2026-10-05T10:00:00Z',
    });
  });

  it('keeps latestDoneAt to moves into done', () => {
    expect(Object.fromEntries(latestDoneAt(rows))).toEqual({ a: '2026-10-01T10:00:00Z', c: '2026-10-04T10:00:00Z' });
    expect(latestMoveInto(rows, new Set(['cancelled'])).get('c')).toBe('2026-10-05T10:00:00Z');
  });
});

describe('the window persists per view', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubStorage = (initial: Record<string, string> = {}) => {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
      },
    });
    return store;
  };

  it("reads a view saved before the field existed as 'all', keeping its other choices", () => {
    stubStorage({ 'list-controls:old': JSON.stringify({ _v: 2, display: { groupBy: 'status', orderBy: 'due', orderDir: 'desc' } }) });
    expect(loadState('old').display).toEqual({ groupBy: 'status', orderBy: 'due', orderDir: 'desc', closed: 'all' });
  });

  it('round-trips the chosen window for its own view only', () => {
    stubStorage();
    saveState('a', { ...DEFAULT_STATE, display: { ...DEFAULT_STATE.display, closed: 'week' } });
    expect(loadState('a').display.closed).toBe('week');
    expect(loadState('b').display.closed).toBe('all');
  });
});
