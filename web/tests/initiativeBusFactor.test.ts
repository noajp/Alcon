// The reading that was missing when the only German speaker took two weeks off
// and four of eight Elements stopped. The board could say afterwards that four
// were blocked; nothing could be asked beforehand how many would stop.
//
// What is pinned here is the arithmetic that decision rests on: what counts as
// a second person, that finished work cannot be depended on, that an absence
// inside the window is read off the same capacity model the load chart uses,
// and that a Worker the Initiative cannot resolve is treated as present rather
// than as away.

import { describe, expect, it } from 'vitest';
import {
  computeBusFactor,
  holderAbsenceLabel,
  type BusElement,
  type BusWorkerInput,
} from '@/ActivitySpace/strategy/initiative/initiativeBusFactorModel';
import { ABSENCE_WINDOW_DAYS } from '@/ActivitySpace/strategy/initiative/initiativeAssumptionModel';
import type { CapacitySpan } from '@/Function/shared/workerCapacity';

// Local noon, so nothing in the window walk can be shifted a day by a timezone.
const NOW = new Date(2026, 7, 31, 12, 0, 0);

function el(over: Partial<BusElement> & { id: string }): BusElement {
  return { status: 'todo', dueDate: null, workerIds: [], ...over };
}

function worker(id: string, spans: readonly CapacitySpan[] = []): BusWorkerInput {
  return { id, name: id.toUpperCase(), worker: { type: 'human', capacity_hours_per_day: 8 }, spans };
}

const away = (start: string, end: string, hours = 0): CapacitySpan => ({
  start_date: start,
  end_date: end,
  capacity_hours_per_day: hours,
});

describe('single dependency — how many people are on it', () => {
  it('counts an Element with one Worker as resting on that Worker', () => {
    const out = computeBusFactor([el({ id: 'a', workerIds: ['p'] })], [worker('p')], NOW);
    expect(out.single).toBe(1);
    expect(out.holders).toHaveLength(1);
    expect(out.holders[0]).toMatchObject({ workerId: 'p', name: 'P', sole: 1, share: 1 });
  });

  it('does not count an Element two Workers are on, whatever their roles', () => {
    const out = computeBusFactor([el({ id: 'a', workerIds: ['p', 'q'] })], [worker('p')], NOW);
    expect(out.single).toBe(0);
    expect(out.holders).toEqual([]);
  });

  it('holds an unstaffed Element out of the count rather than calling it single', () => {
    const out = computeBusFactor([el({ id: 'a' }), el({ id: 'b', workerIds: ['p'] })], [worker('p')], NOW);
    expect(out.unstaffed).toBe(1);
    expect(out.single).toBe(1);
    expect(out.openTotal).toBe(2);
  });

  it('reads one Worker holding two seats on the same Element as one person', () => {
    // assignee and reviewer at once — two rows, no cover.
    const out = computeBusFactor([el({ id: 'a', workerIds: ['p', 'p'] })], [worker('p')], NOW);
    expect(out.single).toBe(1);
    expect(out.holders[0].sole).toBe(1);
  });

  it('has nothing to report when there are no Elements', () => {
    expect(computeBusFactor([], [], NOW)).toEqual({
      openTotal: 0,
      single: 0,
      unstaffed: 0,
      holders: [],
    });
  });

  it('keeps single and the holders in step', () => {
    const out = computeBusFactor(
      [
        el({ id: 'a', workerIds: ['p'] }),
        el({ id: 'b', workerIds: ['p'] }),
        el({ id: 'c', workerIds: ['q'] }),
        el({ id: 'd', workerIds: ['p', 'q'] }),
      ],
      [worker('p'), worker('q')],
      NOW,
    );
    expect(out.single).toBe(3);
    expect(out.holders.reduce((n, h) => n + h.sole, 0)).toBe(3);
    expect(out.holders.map((h) => h.sole)).toEqual([2, 1]);
  });
});

describe('closed work cannot be depended on', () => {
  it('ignores done and cancelled Elements', () => {
    const out = computeBusFactor(
      [
        el({ id: 'a', workerIds: ['p'], status: 'done' }),
        el({ id: 'b', workerIds: ['p'], status: 'cancelled' }),
        el({ id: 'c', workerIds: ['p'], status: 'in_progress' }),
      ],
      [worker('p')],
      NOW,
    );
    expect(out.openTotal).toBe(1);
    expect(out.single).toBe(1);
    expect(out.holders[0].sole).toBe(1);
  });

  it('counts an Element with no status at all, since unset is not finished', () => {
    const out = computeBusFactor([el({ id: 'a', workerIds: ['p'], status: null })], [worker('p')], NOW);
    expect(out.single).toBe(1);
  });
});

describe('the absence overlap', () => {
  it('reports the days with no hours inside the window and how long there is to act', () => {
    const out = computeBusFactor(
      [el({ id: 'a', workerIds: ['p'] })],
      [worker('p', [away('2026-09-03', '2026-09-07')])],
      NOW,
    );
    expect(out.holders[0]).toMatchObject({
      away: true,
      awayDays: 5,
      awayIn: 3,
      awayFrom: '2026-09-03',
    });
  });

  it('says nothing about an absence that starts after the window closes', () => {
    const out = computeBusFactor(
      [el({ id: 'a', workerIds: ['p'] })],
      [worker('p', [away('2026-12-01', '2026-12-10')])],
      NOW,
    );
    expect(out.holders[0]).toMatchObject({ away: false, awayDays: 0, awayIn: null, awayFrom: null });
  });

  it('does not read a reduced day as an absence', () => {
    const out = computeBusFactor(
      [el({ id: 'a', workerIds: ['p'] })],
      [worker('p', [away('2026-09-03', '2026-09-07', 4)])],
      NOW,
    );
    expect(out.holders[0].away).toBe(false);
  });

  it('counts the sole-held Elements whose due date lands in the absence', () => {
    const out = computeBusFactor(
      [
        el({ id: 'a', workerIds: ['p'], dueDate: '2026-09-04' }),
        el({ id: 'b', workerIds: ['p'], dueDate: '2026-09-10' }),
        el({ id: 'c', workerIds: ['p'] }),
        // Covered by a second person, so it is not this Worker's exposure.
        el({ id: 'd', workerIds: ['p', 'q'], dueDate: '2026-09-05' }),
      ],
      [worker('p', [away('2026-09-03', '2026-09-07')])],
      NOW,
    );
    expect(out.holders[0].sole).toBe(3);
    expect(out.holders[0].dueWhileAway).toBe(1);
  });

  it('treats a Worker it cannot resolve as present rather than inventing an absence', () => {
    const out = computeBusFactor([el({ id: 'a', workerIds: ['ghost'] })], [], NOW);
    expect(out.holders[0]).toMatchObject({
      name: 'Unknown Worker',
      sole: 1,
      away: false,
      awayDays: 0,
      dueWhileAway: 0,
    });
  });

  it('reads the whole window, last day included', () => {
    const last = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + ABSENCE_WINDOW_DAYS - 1);
    const key = `${last.getFullYear()}-${`${last.getMonth() + 1}`.padStart(2, '0')}-${`${last.getDate()}`.padStart(2, '0')}`;
    const out = computeBusFactor(
      [el({ id: 'a', workerIds: ['p'] })],
      [worker('p', [away(key, key)])],
      NOW,
    );
    expect(out.holders[0]).toMatchObject({ awayDays: 1, awayIn: ABSENCE_WINDOW_DAYS - 1 });
  });
});

describe('ordering — the dated exposure goes first', () => {
  it('puts a Worker who is leaving above one holding more but staying', () => {
    const out = computeBusFactor(
      [
        el({ id: 'a', workerIds: ['big'] }),
        el({ id: 'b', workerIds: ['big'] }),
        el({ id: 'c', workerIds: ['big'] }),
        el({ id: 'd', workerIds: ['gone'] }),
      ],
      [worker('big'), worker('gone', [away('2026-09-03', '2026-09-07')])],
      NOW,
    );
    expect(out.holders.map((h) => h.workerId)).toEqual(['gone', 'big']);
  });

  it('breaks a tie between two present holders on how much they hold', () => {
    const out = computeBusFactor(
      [
        el({ id: 'a', workerIds: ['q'] }),
        el({ id: 'b', workerIds: ['p'] }),
        el({ id: 'c', workerIds: ['p'] }),
      ],
      [worker('p'), worker('q')],
      NOW,
    );
    expect(out.holders.map((h) => h.workerId)).toEqual(['p', 'q']);
  });
});

describe('holderAbsenceLabel', () => {
  it('says how much of the window is gone when the absence has started', () => {
    const out = computeBusFactor(
      [el({ id: 'a', workerIds: ['p'] })],
      [worker('p', [away('2026-08-30', '2026-09-02')])],
      NOW,
    );
    expect(holderAbsenceLabel(out.holders[0])).toBe('Away 3d');
  });

  it('says how long there is to arrange something when it has not', () => {
    const out = computeBusFactor(
      [el({ id: 'a', workerIds: ['p'] })],
      [worker('p', [away('2026-09-03', '2026-09-07')])],
      NOW,
    );
    expect(holderAbsenceLabel(out.holders[0])).toBe('Away in 3d');
  });

  it('says nothing about a Worker with no absence in the window', () => {
    const out = computeBusFactor([el({ id: 'a', workerIds: ['p'] })], [worker('p')], NOW);
    expect(holderAbsenceLabel(out.holders[0])).toBeNull();
  });
});
