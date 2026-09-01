// el_OPS-032. Two tabletop exercises hit the same wall from opposite sides —
// a medical lead rotating out on D+5, the only German speaker going on leave
// in week 2 — and both facts were about a *period*. These tests pin the two
// decisions that make a period computable: a per-Worker standing day beats the
// agent guess, and overlapping spans take the smallest capacity. The inclusive
// ends are pinned on their own because that is what an absence sounds like
// when someone says it out loud.

import { describe, expect, it } from 'vitest';
import {
  AGENT_CAPACITY_MULTIPLIER,
  DEFAULT_CAPACITY_PER_DAY,
  awayDayCount,
  capacityOnDay,
  dailyCapacity,
  standingCapacity,
  type CapacitySpan,
} from '@/alcon/shared/workerCapacity';

const leave = (start: string, end: string, hours = 0): CapacitySpan => ({
  start_date: start,
  end_date: end,
  capacity_hours_per_day: hours,
});

describe('standingCapacity', () => {
  it('falls back to the default day when the Worker has no stored capacity', () => {
    expect(standingCapacity({ type: 'human', capacity_hours_per_day: null }))
      .toBe(DEFAULT_CAPACITY_PER_DAY);
  });

  it('gives an agent with no stored capacity the multiplied day', () => {
    expect(standingCapacity({ type: 'ai_agent', capacity_hours_per_day: null }))
      .toBe(DEFAULT_CAPACITY_PER_DAY * AGENT_CAPACITY_MULTIPLIER);
  });

  it('uses a stored capacity verbatim', () => {
    expect(standingCapacity({ type: 'human', capacity_hours_per_day: 6 })).toBe(6);
  });

  it('does not multiply an agent whose capacity was written down', () => {
    // A number set on this Worker is a statement about this Worker. Doubling
    // it would make the stored 6 mean 12, which is not what was typed.
    expect(standingCapacity({ type: 'ai_agent', capacity_hours_per_day: 6 })).toBe(6);
  });

  it('honours a stored zero rather than treating it as unset', () => {
    expect(standingCapacity({ type: 'human', capacity_hours_per_day: 0 })).toBe(0);
  });
});

describe('capacityOnDay', () => {
  const away = [leave('2026-09-05', '2026-09-07')];

  it('includes both ends of the span', () => {
    expect(capacityOnDay(8, away, '2026-09-05')).toBe(0);
    expect(capacityOnDay(8, away, '2026-09-06')).toBe(0);
    expect(capacityOnDay(8, away, '2026-09-07')).toBe(0);
  });

  it('leaves the days on either side of the span standing', () => {
    expect(capacityOnDay(8, away, '2026-09-04')).toBe(8);
    expect(capacityOnDay(8, away, '2026-09-08')).toBe(8);
  });

  it('treats a one-day span as one day, not as nothing', () => {
    const single = [leave('2026-09-05', '2026-09-05')];
    expect(capacityOnDay(8, single, '2026-09-05')).toBe(0);
    expect(capacityOnDay(8, single, '2026-09-06')).toBe(8);
  });

  it('returns the standing day when no span covers it', () => {
    expect(capacityOnDay(8, [], '2026-09-05')).toBe(8);
  });

  it('applies a partial span as a reduced day rather than an absence', () => {
    expect(capacityOnDay(8, [leave('2026-09-05', '2026-09-07', 4)], '2026-09-06')).toBe(4);
  });

  it('takes the smallest capacity where spans overlap', () => {
    // Rotated out for the week and on leave for two days inside it: the days
    // that carry both constraints are the days off, not the half-days.
    const spans = [leave('2026-09-01', '2026-09-07', 4), leave('2026-09-03', '2026-09-04', 0)];
    expect(capacityOnDay(8, spans, '2026-09-02')).toBe(4);
    expect(capacityOnDay(8, spans, '2026-09-03')).toBe(0);
    expect(capacityOnDay(8, spans, '2026-09-04')).toBe(0);
    expect(capacityOnDay(8, spans, '2026-09-05')).toBe(4);
  });

  it('does not depend on the order the spans arrive in', () => {
    const spans = [leave('2026-09-01', '2026-09-07', 4), leave('2026-09-03', '2026-09-04', 0)];
    const reversed = [...spans].reverse();
    for (const day of ['2026-09-02', '2026-09-03', '2026-09-05']) {
      expect(capacityOnDay(8, reversed, day)).toBe(capacityOnDay(8, spans, day));
    }
  });

  it('never raises a day above the standing capacity', () => {
    // A span is a constraint. One that claims more hours than the Worker has
    // must not hand them out.
    expect(capacityOnDay(8, [leave('2026-09-05', '2026-09-07', 40)], '2026-09-06')).toBe(8);
  });

  it('compares months and years, not day numbers', () => {
    const span = [leave('2026-09-28', '2026-10-02')];
    expect(capacityOnDay(8, span, '2026-09-30')).toBe(0);
    expect(capacityOnDay(8, span, '2026-10-01')).toBe(0);
    expect(capacityOnDay(8, span, '2026-10-03')).toBe(8);
    expect(capacityOnDay(8, span, '2025-09-30')).toBe(8);
  });
});

describe('dailyCapacity', () => {
  const days = ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']
    .map((s) => {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    });

  it('maps the window in order', () => {
    const out = dailyCapacity(
      { type: 'human', capacity_hours_per_day: null },
      [leave('2026-09-05', '2026-09-07')],
      days,
    );
    expect(out).toEqual([8, 0, 0, 0, 8]);
  });

  it('reduces an agent day by a span like any other', () => {
    const out = dailyCapacity(
      { type: 'ai_agent', capacity_hours_per_day: null },
      [leave('2026-09-06', '2026-09-06', 2)],
      days,
    );
    expect(out).toEqual([16, 16, 2, 16, 16]);
  });

  it('returns an empty window for an empty window', () => {
    expect(dailyCapacity({ type: 'human', capacity_hours_per_day: null }, [], [])).toEqual([]);
  });
});

describe('awayDayCount', () => {
  it('counts only the days with no hours at all', () => {
    expect(awayDayCount([8, 0, 4, 0, 8])).toBe(2);
  });

  it('is zero for a window nobody is away in', () => {
    expect(awayDayCount([8, 8, 8])).toBe(0);
  });
});
