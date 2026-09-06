import { describe, expect, it } from 'vitest';
import {
  directionLabel,
  directionSymbol,
  evaluateMeasure,
  formatMeasureValue,
  isMeasure,
  measureState,
  measureStateLabel,
  meetsTarget,
  orderMeasures,
  parseMeasureValue,
  tallyMeasures,
  targetLabel,
  targetSentence,
  type MeasureInput,
} from '@/alcon/element/actions/initiativeMeasureModel';

// The measures surface makes exactly one claim per row — "the number somebody
// read does, or does not, satisfy the number the condition names" — and it has
// two ways of being wrong that matter more than the arithmetic. It can report a
// miss nobody observed (an unread condition rendered as failing), and it can
// report a pass nobody earned (a condition with no target counted as met). The
// five conditions of the accreditation exercise below are the shape that found
// both: three failing, one unread, one whose target is zero and whose direction
// is the opposite of every other row's.

function measure(over: Partial<MeasureInput> = {}): MeasureInput {
  return {
    id: 'm-1',
    title: 'Hand hygiene compliance',
    target: 80,
    actual: null,
    unit: '%',
    direction: 'at_least',
    measuredAt: null,
    orderIndex: 1,
    ...over,
  };
}

describe('isMeasure', () => {
  it('separates measures from the other kinds sharing the table', () => {
    expect(isMeasure('measure')).toBe(true);
    expect(isMeasure('decision')).toBe(false);
    expect(isMeasure('assumption')).toBe(false);
    expect(isMeasure('master')).toBe(false);
    expect(isMeasure(null)).toBe(false);
    expect(isMeasure(undefined)).toBe(false);
  });
});

describe('meetsTarget', () => {
  it('reads at_least as met on or above the number', () => {
    expect(meetsTarget(88, 80, 'at_least')).toBe(true);
    expect(meetsTarget(71, 80, 'at_least')).toBe(false);
    // The boundary is met, not missed: "at or above 80%" includes 80%.
    expect(meetsTarget(80, 80, 'at_least')).toBe(true);
  });

  it('reads at_most as met on or below the number', () => {
    expect(meetsTarget(0, 0, 'at_most')).toBe(true);
    expect(meetsTarget(3, 0, 'at_most')).toBe(false);
    expect(meetsTarget(-2, 0, 'at_most')).toBe(true);
  });

  it('does not derive the direction from the numbers', () => {
    // The same pair reads opposite ways. This is the whole reason the column
    // is stored: 100% trained and 0 unclosed corrections are both full marks.
    expect(meetsTarget(100, 100, 'at_least')).toBe(true);
    expect(meetsTarget(100, 0, 'at_most')).toBe(false);
  });
});

describe('measureState', () => {
  it('meets and misses an at_least condition', () => {
    expect(measureState(measure({ actual: 88 }))).toBe('met');
    expect(measureState(measure({ actual: 71 }))).toBe('missed');
    expect(measureState(measure({ actual: 80 }))).toBe('met');
  });

  it('meets and misses an at_most condition', () => {
    const unclosed = measure({ target: 0, unit: '件', direction: 'at_most' });
    expect(measureState({ ...unclosed, actual: 0 })).toBe('met');
    expect(measureState({ ...unclosed, actual: 2 })).toBe('missed');
  });

  it('reports an unread condition as unmeasured, never as a miss', () => {
    expect(measureState(measure({ actual: null }))).toBe('unmeasured');
    // Zero is a reading. Treating a missing number as one would report a miss
    // against every condition nobody has got to yet.
    expect(measureState(measure({ actual: 0 }))).toBe('missed');
    expect(measureState(measure({ target: 0, direction: 'at_most', actual: 0 }))).toBe('met');
  });

  it('reports a condition with no target as unstated, never as met', () => {
    expect(measureState(measure({ target: null, actual: 88 }))).toBe('unstated');
    expect(measureState(measure({ target: null, actual: null }))).toBe('unstated');
  });

  it('reports a condition with no direction as unstated', () => {
    // Without it there is no answer to which side counts, and picking one
    // would be inventing the condition rather than reading it.
    expect(measureState(measure({ direction: null, actual: 88 }))).toBe('unstated');
  });

  it('treats a non-finite number as absent rather than comparing it', () => {
    expect(measureState(measure({ actual: Number.NaN }))).toBe('unmeasured');
    expect(measureState(measure({ target: Number.NaN, actual: 88 }))).toBe('unstated');
  });
});

describe('evaluateMeasure', () => {
  it('carries met alongside the state', () => {
    expect(evaluateMeasure(measure({ actual: 88 })).met).toBe(true);
    expect(evaluateMeasure(measure({ actual: 71 })).met).toBe(false);
    expect(evaluateMeasure(measure({ actual: null })).met).toBe(false);
  });
});

describe('orderMeasures', () => {
  it('puts failing first, unread second, unstated third, met last', () => {
    const ordered = orderMeasures([
      measure({ id: 'met', actual: 100, target: 100 }),
      measure({ id: 'unstated', target: null }),
      measure({ id: 'unread', actual: null }),
      measure({ id: 'missed', actual: 71 }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual(['missed', 'unread', 'unstated', 'met']);
  });

  it('breaks ties inside a band on the age of the reading, stalest first', () => {
    const ordered = orderMeasures([
      measure({ id: 'fresh', actual: 71, measuredAt: '2026-08-30T09:00:00Z' }),
      measure({ id: 'stale', actual: 82, target: 90, measuredAt: '2026-07-14T09:00:00Z' }),
      measure({ id: 'undated', actual: 88, target: 95, measuredAt: null }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual(['undated', 'stale', 'fresh']);
  });

  it('does not rank a miss by how far off it is', () => {
    // Nine points of per-cent and three unclosed cases are not on one scale.
    // Same reading time, so the order falls through to the author's own.
    const at = '2026-08-30T09:00:00Z';
    const ordered = orderMeasures([
      measure({ id: 'far', actual: 10, target: 95, orderIndex: 2, measuredAt: at }),
      measure({ id: 'near', actual: 94, target: 95, orderIndex: 1, measuredAt: at }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual(['near', 'far']);
  });

  it('is total, so two undated unread rows do not come back in an arbitrary order', () => {
    const rows = [
      measure({ id: 'b', orderIndex: 0 }),
      measure({ id: 'a', orderIndex: 0 }),
    ];
    expect(orderMeasures(rows).map((m) => m.id)).toEqual(['a', 'b']);
    expect(orderMeasures([...rows].reverse()).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('leaves the input alone', () => {
    const rows = [measure({ id: 'met', actual: 100 }), measure({ id: 'missed', actual: 1 })];
    orderMeasures(rows);
    expect(rows.map((m) => m.id)).toEqual(['met', 'missed']);
  });
});

describe('tallyMeasures', () => {
  it('counts the accreditation board the way its header reads it', () => {
    const tally = tallyMeasures(
      orderMeasures([
        measure({ id: 'hygiene', title: 'Hand hygiene', target: 80, actual: 71 }),
        measure({ id: 'summaries', title: 'Discharge summaries', target: 90, actual: 82 }),
        measure({ id: 'training', title: 'Mandatory training', target: 100, actual: 100 }),
        measure({ id: 'falls', title: 'Falls assessment', target: 95, actual: 88 }),
        measure({
          id: 'corrections',
          title: 'Unclosed safety corrections',
          target: 0,
          actual: 0,
          unit: '件',
          direction: 'at_most',
        }),
      ]),
    );
    expect(tally).toEqual({ met: 2, missed: 3, unmeasured: 0, unstated: 0, total: 5 });
  });

  it('keeps unread apart from failing in the count', () => {
    const tally = tallyMeasures(
      orderMeasures([
        measure({ id: 'a', actual: 71 }),
        measure({ id: 'b', actual: null }),
        measure({ id: 'c', target: null }),
        measure({ id: 'd', actual: 88 }),
      ]),
    );
    expect(tally).toEqual({ met: 1, missed: 1, unmeasured: 1, unstated: 1, total: 4 });
  });

  it('counts nothing on an empty Initiative', () => {
    expect(tallyMeasures([])).toEqual({
      met: 0,
      missed: 0,
      unmeasured: 0,
      unstated: 0,
      total: 0,
    });
  });
});

describe('labels', () => {
  it('names each state', () => {
    expect(measureStateLabel('met')).toBe('Met');
    expect(measureStateLabel('missed')).toBe('Missed');
    expect(measureStateLabel('unmeasured')).toBe('Not measured');
    expect(measureStateLabel('unstated')).toBe('No target set');
  });

  it('spells the direction out and prints it short', () => {
    expect(directionLabel('at_least')).toBe('At least');
    expect(directionLabel('at_most')).toBe('At most');
    expect(directionSymbol('at_least')).toBe('≥');
    expect(directionSymbol('at_most')).toBe('≤');
  });

  it('attaches a symbol unit to the number and spaces a word one', () => {
    expect(formatMeasureValue(80, '%')).toBe('80%');
    expect(formatMeasureValue(0, '件')).toBe('0件');
    expect(formatMeasureValue(12, '世帯/日')).toBe('12世帯/日');
    expect(formatMeasureValue(8, 'hours')).toBe('8 hours');
    expect(formatMeasureValue(71.5, null)).toBe('71.5');
    expect(formatMeasureValue(80, '  ')).toBe('80');
  });

  it('has nothing to format when there is no number', () => {
    expect(formatMeasureValue(null, '%')).toBeNull();
    expect(formatMeasureValue(Number.NaN, '%')).toBeNull();
  });

  it('states what the condition requires, both ways round', () => {
    expect(targetLabel(measure())).toBe('≥ 80%');
    expect(targetSentence(measure())).toBe('at least 80%');
    const unclosed = measure({ target: 0, unit: '件', direction: 'at_most' });
    expect(targetLabel(unclosed)).toBe('≤ 0件');
    expect(targetSentence(unclosed)).toBe('at most 0件');
  });

  it('states nothing when the condition names no number', () => {
    expect(targetLabel(measure({ target: null }))).toBeNull();
    expect(targetLabel(measure({ direction: null }))).toBeNull();
    expect(targetSentence(measure({ target: null }))).toBeNull();
    expect(targetSentence(measure({ direction: null }))).toBeNull();
  });
});

describe('parseMeasureValue', () => {
  it('takes a number, with or without the surrounding spaces', () => {
    expect(parseMeasureValue('71')).toEqual({ ok: true, value: 71 });
    expect(parseMeasureValue(' 71.5 ')).toEqual({ ok: true, value: 71.5 });
    expect(parseMeasureValue('-2')).toEqual({ ok: true, value: -2 });
    expect(parseMeasureValue('0')).toEqual({ ok: true, value: 0 });
  });

  it('reads blank as clearing the reading, not as zero', () => {
    // `Number('')` is 0, so this is the one that would quietly report a miss
    // against a condition nobody measured.
    expect(parseMeasureValue('')).toEqual({ ok: true, value: null });
    expect(parseMeasureValue('   ')).toEqual({ ok: true, value: null });
  });

  it('refuses anything that is not a finite number', () => {
    expect(parseMeasureValue('abc')).toEqual({ ok: false });
    expect(parseMeasureValue('71%')).toEqual({ ok: false });
    expect(parseMeasureValue('Infinity')).toEqual({ ok: false });
  });
});
