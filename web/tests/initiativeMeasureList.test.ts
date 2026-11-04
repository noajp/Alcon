import { describe, expect, it } from 'vitest';
import {
  addTallies,
  EMPTY_TALLY,
  measureSummary,
  measureTallyDetail,
  talliesByInitiative,
  type MeasureInput,
} from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';

// A list row reads its success conditions from one batch for the whole list.
// The split must give every listed Strategy an entry (an empty one means
// "no success conditions", which the row says out loud), and the summary must
// name misses and unread conditions before anything else.

function row(initiativeId: string, id: string, target: number | null, actual: number | null): MeasureInput & { initiativeId: string } {
  return { initiativeId, id, title: id, target, actual, unit: '%', direction: 'at_least', measuredAt: null, orderIndex: 0 };
}

describe('talliesByInitiative', () => {
  it('splits one batch per Strategy and gives the empty ones an empty tally', () => {
    const tallies = talliesByInitiative(['a', 'b', 'c'], [
      row('a', 'a1', 80, 90), // met
      row('a', 'a2', 80, 70), // missed
      row('a', 'a3', 80, 60), // missed
      row('b', 'b1', 80, null), // unmeasured
      row('b', 'b2', null, null), // unstated
      row('x', 'x1', 80, 90), // not listed
    ]);
    expect(tallies.get('a')).toEqual({ met: 1, missed: 2, unmeasured: 0, unstated: 0, total: 3 });
    expect(tallies.get('b')).toEqual({ met: 0, missed: 0, unmeasured: 1, unstated: 1, total: 2 });
    expect(tallies.get('c')).toEqual(EMPTY_TALLY);
    expect(tallies.has('x')).toBe(false);
  });
});

describe('addTallies', () => {
  it('adds every band', () => {
    expect(addTallies({ met: 1, missed: 2, unmeasured: 3, unstated: 4, total: 10 }, { met: 1, missed: 1, unmeasured: 1, unstated: 1, total: 4 }))
      .toEqual({ met: 2, missed: 3, unmeasured: 4, unstated: 5, total: 14 });
  });
});

describe('measureSummary', () => {
  it('says there are no success conditions when there are none', () => {
    expect(measureSummary(EMPTY_TALLY)).toEqual({ text: 'No success conditions', tone: 'none' });
  });
  it('names misses and unread conditions against the total, a miss being the alarm', () => {
    expect(measureSummary({ met: 2, missed: 2, unmeasured: 1, unstated: 0, total: 5 }))
      .toEqual({ text: '2 missed · 1 not measured / 5', tone: 'missed' });
    expect(measureSummary({ met: 1, missed: 0, unmeasured: 2, unstated: 0, total: 3 }))
      .toEqual({ text: '2 not measured / 3', tone: 'open' });
  });
  it('reports the met share when nothing is missed or unread', () => {
    expect(measureSummary({ met: 3, missed: 0, unmeasured: 0, unstated: 0, total: 3 })).toEqual({ text: '3/3 met', tone: 'met' });
    // A condition with no target is short of all-met, so it stays a caution.
    expect(measureSummary({ met: 2, missed: 0, unmeasured: 0, unstated: 1, total: 3 })).toEqual({ text: '2/3 met', tone: 'open' });
  });
});

describe('measureTallyDetail', () => {
  it('spells out the non-empty bands', () => {
    expect(measureTallyDetail({ met: 1, missed: 2, unmeasured: 0, unstated: 1, total: 4 })).toBe('Met 1 · Missed 2 · No target set 1');
  });
});
