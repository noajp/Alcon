import { describe, it, expect } from 'vitest';
import { applyClosedWindow, isWithinClosedWindow } from '../src/Function/shared/listControls/closedWindow';
import { loadState } from '../src/Function/shared/listControls/types';

const NOW = new Date('2026-11-02T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const el = (status: string, updated_at: string | null, created_at: string | null = null) => ({ status, updated_at, created_at });

describe('isWithinClosedWindow', () => {
  it('always keeps open Elements, however old', () => {
    for (const w of ['all', 'day', 'week', 'month', 'none'] as const) {
      expect(isWithinClosedWindow(el('todo', ago(400)), w, NOW)).toBe(true);
      expect(isWithinClosedWindow(el('blocked', null), w, NOW)).toBe(true);
    }
  });

  it("keeps every closed Element under 'all' and unset, and none under 'none'", () => {
    expect(isWithinClosedWindow(el('done', ago(400)), 'all', NOW)).toBe(true);
    expect(isWithinClosedWindow(el('done', ago(400)), undefined, NOW)).toBe(true);
    expect(isWithinClosedWindow(el('done', ago(0)), 'none', NOW)).toBe(false);
    expect(isWithinClosedWindow(el('cancelled', ago(0)), 'none', NOW)).toBe(false);
  });

  it('keeps a closed Element only when it closed inside the window, boundary included', () => {
    expect(isWithinClosedWindow(el('done', ago(0.5)), 'day', NOW)).toBe(true);
    expect(isWithinClosedWindow(el('done', ago(1)), 'day', NOW)).toBe(true);
    expect(isWithinClosedWindow(el('done', ago(1.01)), 'day', NOW)).toBe(false);
    expect(isWithinClosedWindow(el('done', ago(6)), 'week', NOW)).toBe(true);
    expect(isWithinClosedWindow(el('cancelled', ago(8)), 'week', NOW)).toBe(false);
    expect(isWithinClosedWindow(el('done', ago(29)), 'month', NOW)).toBe(true);
    expect(isWithinClosedWindow(el('done', ago(31)), 'month', NOW)).toBe(false);
  });

  it('falls back to created_at, and treats a closed Element with no timestamp as old', () => {
    expect(isWithinClosedWindow(el('done', null, ago(2)), 'week', NOW)).toBe(true);
    expect(isWithinClosedWindow(el('done', null, null), 'month', NOW)).toBe(false);
    expect(isWithinClosedWindow(el('done', 'not a date'), 'month', NOW)).toBe(false);
  });
});

describe('applyClosedWindow', () => {
  const rows = [el('todo', ago(100)), el('done', ago(3)), el('done', ago(20)), el('cancelled', ago(2))];

  it("returns the same array for 'all'", () => {
    expect(applyClosedWindow(rows, 'all', NOW)).toBe(rows);
  });

  it('drops closed Elements outside the window and keeps order', () => {
    expect(applyClosedWindow(rows, 'week', NOW)).toEqual([rows[0], rows[1], rows[3]]);
    expect(applyClosedWindow(rows, 'none', NOW)).toEqual([rows[0]]);
  });
});

describe('loadState', () => {
  it("reads a saved state without the field as 'all'", () => {
    // node has no window → the default state, which must carry the field.
    expect(loadState('x').display.closed).toBe('all');
  });
});
