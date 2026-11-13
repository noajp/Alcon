import { describe, expect, it } from 'vitest';
import { firstDeadline, outlook, warmthGradient, warnsAboutTime } from '@/ActivitySpace/execution/element/gantt/ganttUrgency';

describe('Gantt colour', () => {
  it('measures a bar against the soonest of its dates, none when it has none', () => {
    expect(firstDeadline(['2026-12-01', '2026-11-20', null])).toBe('2026-11-20');
    expect(firstDeadline([null, undefined])).toBeNull();
  });

  it('leaves finished and set-aside work alone', () => {
    expect(warnsAboutTime('done')).toBe(false);
    expect(warnsAboutTime('cancelled')).toBe(false);
    expect(warnsAboutTime('in_progress')).toBe(true);
    expect(warnsAboutTime(null)).toBe(true);
  });

  it('reads the outlook from progress against the share of the span gone by', () => {
    // 10-day bar, today its 5th day: half gone
    const at = (p: number) => outlook(p, '2026-11-10', '2026-11-19', '2026-11-14');
    expect(at(50)).toBe(0);
    expect(at(65)).toBeCloseTo(0.5);
    expect(at(80)).toBe(1);
    expect(at(35)).toBeCloseTo(-0.5);
    expect(at(0)).toBe(-1);
  });

  it('expects nothing before a bar starts and cannot judge without dates', () => {
    expect(outlook(0, '2026-11-20', '2026-11-30', '2026-11-14')).toBe(0);
    expect(outlook(30, '2026-11-20', '2026-11-30', '2026-11-14')).toBe(1);
    expect(outlook(100, null, '2026-11-10', '2026-11-14')).toBe(0);
  });

  it('reads a finished span without finished work as surely late', () => {
    expect(outlook(40, '2026-11-01', '2026-11-10', '2026-11-14')).toBe(-1);
    expect(outlook(100, '2026-11-01', '2026-11-10', '2026-11-14')).toBe(0);
  });

  it('opens clear and ends in blue when sure of it, in red when not', () => {
    const sure = warmthGradient(400, 400, 1);
    const unsure = warmthGradient(400, 400, -1);
    expect(sure.startsWith('linear-gradient(to right, color-mix(in oklab, var(--accent-default) 0.0%, transparent) 0.0px')).toBe(true);
    expect(sure).not.toContain('var(--status-success)');
    expect(sure).not.toContain('var(--status-danger)');
    expect(unsure).toContain('var(--status-danger)');
    expect(unsure).not.toContain('var(--accent-default)');
  });

  it('deepens smoothly: every stop is at least as strong as the one before', () => {
    const alphas = [...warmthGradient(300, 300, 0.5).matchAll(/ ([\d.]+)%, transparent\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(6);
    expect(alphas.every((a, i) => i === 0 || a >= alphas[i - 1])).toBe(true);
  });

  it('steps to red beyond the date, only when the date is inside the bar', () => {
    const inside = warmthGradient(200, 400, 1);
    expect(inside).toContain('var(--status-danger)');
    expect(inside.match(/200\.0px/g)?.length).toBe(2);
    expect(warmthGradient(400, 400, 1).match(/400\.0px/g)?.length).toBe(1);
    expect(warmthGradient(900, 400, 1).match(/400\.0px/g)?.length).toBe(1);
  });
});
