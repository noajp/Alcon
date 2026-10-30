// Closing a Phase — the three rules that break quietly if they drift.
//
//   1. Out of time is derived. `end_date` is inclusive, so the last day is
//      inside the Phase; a Phase that has been closed is never out of time
//      however long ago its dates went by. Storing that as a column would let
//      it disagree with the two facts it is made of.
//   2. The rollup has to be able to reach 100%. Cancelled Elements sit in
//      neither half — in the denominator they put a ceiling under the number.
//   3. Nothing carries by itself. `keep` writes nothing, `carry` with nowhere
//      to carry to writes nothing, and every carried Element comes back one
//      round older.

import { describe, expect, it } from 'vitest';

import {
  PHASE_STANDING_LABEL,
  nextOpenPhase,
  phaseRollup,
  phaseStanding,
  planPhaseClose,
  todayYMD,
  unfinishedIn,
  type PhaseElementRow,
} from '@/Function/strategy/phaseClose';
import type { Phase, PhaseStatus } from '@/types/database';

const phase = (over: Partial<Phase> & { id: string }): Phase => ({
  domain_id: 'd1',
  name: over.id,
  start_date: null,
  end_date: null,
  order_index: null,
  status: 'planned',
  closed_at: null,
  closing_note: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...over,
});

const el = (
  id: string,
  status: PhaseElementRow['status'],
  phase_id: string | null,
  carried_over_count = 0,
): PhaseElementRow => ({ id, status, phase_id, carried_over_count });

describe('phaseStanding', () => {
  const window = { start_date: '2026-09-01', end_date: '2026-09-30' };

  it('is not out of time on the end date itself — end_date is inclusive', () => {
    expect(phaseStanding({ status: 'active', ...window }, '2026-09-30')).toBe('active');
  });

  it('is out of time the day after the end date', () => {
    expect(phaseStanding({ status: 'active', ...window }, '2026-10-01')).toBe('out_of_time');
  });

  it('carries a planned Phase past its end date into out of time too', () => {
    expect(phaseStanding({ status: 'planned', ...window }, '2026-10-01')).toBe('out_of_time');
  });

  it('never calls a complete Phase out of time, however long ago it ended', () => {
    expect(phaseStanding({ status: 'complete', ...window }, '2027-05-01')).toBe('complete');
  });

  it('has no way to run out of time without an end date', () => {
    expect(phaseStanding({ status: 'active', start_date: '2026-09-01', end_date: null }, '2030-01-01'))
      .toBe('active');
    expect(phaseStanding({ status: 'planned', start_date: null, end_date: null }, '2030-01-01'))
      .toBe('planned');
  });

  it('reads a still-planned Phase whose window has opened as active', () => {
    expect(phaseStanding({ status: 'planned', ...window }, '2026-09-15')).toBe('active');
  });

  it('leaves a Phase that has not started yet planned', () => {
    expect(phaseStanding({ status: 'planned', ...window }, '2026-08-31')).toBe('planned');
  });

  it('labels every standing', () => {
    expect(Object.values(PHASE_STANDING_LABEL).every((l) => l.length > 0)).toBe(true);
  });
});

describe('todayYMD', () => {
  it('formats the local calendar date, zero-padded', () => {
    expect(todayYMD(new Date(2026, 8, 1, 23, 59))).toBe('2026-09-01');
  });
});

describe('phaseRollup', () => {
  it('reports nothing for a Phase with no Elements', () => {
    expect(phaseRollup([], 'p1')).toEqual({ done: 0, total: 0, unfinished: 0 });
  });

  it('reaches everything done', () => {
    const rows = [el('a', 'done', 'p1'), el('b', 'done', 'p1')];
    expect(phaseRollup(rows, 'p1')).toEqual({ done: 2, total: 2, unfinished: 0 });
  });

  it('splits a mixed Phase into done and unfinished', () => {
    const rows = [
      el('a', 'done', 'p1'),
      el('b', 'in_progress', 'p1'),
      el('c', 'todo', 'p1'),
      el('d', 'blocked', 'p1'),
    ];
    expect(phaseRollup(rows, 'p1')).toEqual({ done: 1, total: 4, unfinished: 3 });
  });

  it('keeps cancelled Elements out of both halves', () => {
    const rows = [el('a', 'done', 'p1'), el('b', 'cancelled', 'p1')];
    expect(phaseRollup(rows, 'p1')).toEqual({ done: 1, total: 1, unfinished: 0 });
  });

  it('counts only the Phase it was asked about', () => {
    const rows = [el('a', 'done', 'p1'), el('b', 'todo', 'p2'), el('c', 'todo', null)];
    expect(phaseRollup(rows, 'p1')).toEqual({ done: 1, total: 1, unfinished: 0 });
  });

  it('treats an Element with no status as unfinished', () => {
    expect(phaseRollup([el('a', null, 'p1')], 'p1')).toEqual({ done: 0, total: 1, unfinished: 1 });
  });
});

describe('unfinishedIn', () => {
  it('is the work a close has to find a home for', () => {
    const rows = [
      el('a', 'done', 'p1'),
      el('b', 'cancelled', 'p1'),
      el('c', 'review', 'p1'),
      el('d', 'todo', 'p2'),
    ];
    expect(unfinishedIn(rows, 'p1').map((e) => e.id)).toEqual(['c']);
  });
});

describe('planPhaseClose', () => {
  const rows = [
    el('a', 'done', 'p1'),
    el('b', 'todo', 'p1'),
    el('c', 'in_progress', 'p1', 2),
    el('d', 'todo', 'p2'),
  ];

  it('writes nothing when the unfinished work stays put', () => {
    expect(planPhaseClose({ elements: rows, phaseId: 'p1', destination: 'keep' })).toEqual([]);
  });

  it('writes nothing at all when everything is settled', () => {
    const settled = [el('a', 'done', 'p1'), el('b', 'cancelled', 'p1')];
    expect(planPhaseClose({ elements: settled, phaseId: 'p1', destination: 'carry', nextPhaseId: 'p2' }))
      .toEqual([]);
  });

  it('drops the unfinished Elements out of the Phase, leaving done ones alone', () => {
    expect(planPhaseClose({ elements: rows, phaseId: 'p1', destination: 'unassign' })).toEqual([
      { phase_id: null, ids: ['b', 'c'] },
    ]);
  });

  it('carries forward and ages each Element by one round', () => {
    expect(planPhaseClose({ elements: rows, phaseId: 'p1', destination: 'carry', nextPhaseId: 'p2' }))
      .toEqual([
        { phase_id: 'p2', carried_over_count: 1, ids: ['b'] },
        { phase_id: 'p2', carried_over_count: 3, ids: ['c'] },
      ]);
  });

  it('moves everything that has been round the same number of times in one write', () => {
    const many = [el('a', 'todo', 'p1'), el('b', 'review', 'p1'), el('c', 'blocked', 'p1')];
    expect(planPhaseClose({ elements: many, phaseId: 'p1', destination: 'carry', nextPhaseId: 'p2' }))
      .toEqual([{ phase_id: 'p2', carried_over_count: 1, ids: ['a', 'b', 'c'] }]);
  });

  it('refuses to carry to nowhere rather than emptying the Phase', () => {
    expect(planPhaseClose({ elements: rows, phaseId: 'p1', destination: 'carry', nextPhaseId: null }))
      .toEqual([]);
  });

  it('treats a missing carried_over_count as a first round', () => {
    const bare: PhaseElementRow[] = [{ id: 'a', status: 'todo', phase_id: 'p1' }];
    expect(planPhaseClose({ elements: bare, phaseId: 'p1', destination: 'carry', nextPhaseId: 'p2' }))
      .toEqual([{ phase_id: 'p2', carried_over_count: 1, ids: ['a'] }]);
  });
});

describe('nextOpenPhase', () => {
  const at = (id: string, status: PhaseStatus) => phase({ id, status });

  it('is the following Phase in the list', () => {
    const list = [at('p1', 'active'), at('p2', 'planned'), at('p3', 'planned')];
    expect(nextOpenPhase(list, 'p1')?.id).toBe('p2');
  });

  it('skips Phases that are themselves closed', () => {
    const list = [at('p1', 'active'), at('p2', 'complete'), at('p3', 'planned')];
    expect(nextOpenPhase(list, 'p1')?.id).toBe('p3');
  });

  it('has nowhere to carry from the last Phase', () => {
    expect(nextOpenPhase([at('p1', 'active')], 'p1')).toBeNull();
  });

  it('never carries backwards', () => {
    const list = [at('p1', 'planned'), at('p2', 'active')];
    expect(nextOpenPhase(list, 'p2')).toBeNull();
  });

  it('answers for a Phase that is not in the list', () => {
    expect(nextOpenPhase([at('p1', 'active')], 'gone')).toBeNull();
  });
});
