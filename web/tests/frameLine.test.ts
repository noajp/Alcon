import { describe, expect, it } from 'vitest';
import { embedSpecsIn } from '@/Function/notebook/editor/embedBlocks';
import {
  boundFrameSpec, draftFrameSpec, elementsOn, frameRef, labelColumnEm, measureStanding,
  placedFrameIds, unplacedFrameRows,
} from '@/ActivitySpace/strategy/initiative/frameLineModel';

const fence = (body: string, lang = 'clayware') => '```' + lang + '\n' + body + '\n```';

describe('embedSpecsIn', () => {
  it('reads every block of a description, in order, under either fence name', () => {
    const md = ['Where we are going.', fence('{"view":"intent","id":"a"}'), 'More prose.', fence('{"view":"gantt"}', 'alcon')].join('\n\n');
    expect(embedSpecsIn(md)).toEqual([{ view: 'intent', id: 'a' }, { view: 'gantt' }]);
  });

  it('skips a fence that is not a spec, and any other code block', () => {
    const md = [fence('not json'), fence('{"id":"no view"}'), fence('{"view":"intent","id":"x"}', 'json')].join('\n\n');
    expect(embedSpecsIn(md)).toEqual([]);
  });

  it('reads nothing from an empty description', () => {
    expect(embedSpecsIn('')).toEqual([]);
    expect(embedSpecsIn(null)).toEqual([]);
  });
});

describe('frameRef', () => {
  it('tells a line pointing at its row from one not yet written', () => {
    expect(frameRef(boundFrameSpec('row-1'))).toEqual({ id: 'row-1' });
    expect(frameRef(draftFrameSpec('assumption'))).toEqual({ kind: 'assumption', text: '' });
    expect(frameRef(draftFrameSpec('decision', 'Narrow to firms of 10–50'))).toEqual({ kind: 'decision', text: 'Narrow to firms of 10–50' });
  });

  it('is null for another block, and for a frame block naming neither a row nor a kind', () => {
    expect(frameRef({ view: 'gantt' })).toBeNull();
    expect(frameRef({ view: 'intent' })).toBeNull();
    expect(frameRef({ view: 'intent', kind: 'master' })).toBeNull();
    expect(frameRef({ view: 'intent', id: '' })).toBeNull();
  });
});

describe('placedFrameIds', () => {
  it('lists the rows a description places, each once, drafts left out', () => {
    const md = [
      fence('{"view":"intent","id":"b"}'),
      fence('{"view":"intent","kind":"measure"}'),
      fence('{"view":"intent","id":"a"}'),
      fence('{"view":"intent","id":"b"}'),
      fence('{"view":"progress"}'),
    ].join('\n\n');
    expect(placedFrameIds(md)).toEqual(['b', 'a']);
  });
});

describe('unplacedFrameRows', () => {
  const rows = [
    { id: 'root', kind: 'master', order_index: 0 },
    { id: 'd1', kind: 'decision', order_index: 1 },
    { id: 'a2', kind: 'assumption', order_index: 5 },
    { id: 'm1', kind: 'measure', order_index: 4 },
    { id: 'a1', kind: 'assumption', order_index: 2 },
    { id: 'd0', kind: 'decision', order_index: 3, superseded_by_intent_id: 'd1' },
  ];

  it('keeps what the description does not place: conditions, then hypotheses, then what was decided', () => {
    expect(unplacedFrameRows(rows, []).map((r) => r.id)).toEqual(['m1', 'a1', 'a2', 'd1']);
  });

  it('leaves out a placed row, the root, and a decision another replaced', () => {
    expect(unplacedFrameRows(rows, ['a1', 'm1']).map((r) => r.id)).toEqual(['a2', 'd1']);
  });

  it('is empty when every row is placed', () => {
    expect(unplacedFrameRows(rows, ['m1', 'a1', 'a2', 'd1'])).toEqual([]);
  });
});

describe('elementsOn', () => {
  const bindings = [
    { intent_id: 'a', target_type: 'element', target_id: 'e1' },
    { intent_id: 'a', target_type: 'element', target_id: 'e1' },
    { intent_id: 'a', target_type: 'element', target_id: 'e2' },
    { intent_id: 'a', target_type: 'object', target_id: 'o1' },
    { intent_id: 'b', target_type: 'element', target_id: 'e3' },
  ];

  it('counts the Elements resting on a row, each once, and nothing else bound to it', () => {
    expect(elementsOn(bindings, 'a')).toBe(2);
    expect(elementsOn(bindings, 'b')).toBe(1);
    expect(elementsOn(bindings, 'c')).toBe(0);
  });
});

describe('measureStanding', () => {
  it('shows the reading against the target', () => {
    expect(measureStanding({ target_value: 10, actual_value: 3, unit: '社' })).toBe('3 / 10社');
  });

  it('shows a dash for a condition nobody has read yet', () => {
    expect(measureStanding({ target_value: 80, actual_value: null, unit: '%' })).toBe('– / 80%');
  });

  it('is null without a target', () => {
    expect(measureStanding({ target_value: null, actual_value: 3, unit: '社' })).toBeNull();
  });
});

describe('labelColumnEm', () => {
  it('gives full-width characters an em each and Latin a little over half', () => {
    expect(labelColumnEm(['仮説', '成功条件', '決めたこと'])).toBe(5);
    expect(labelColumnEm(['Decided'])).toBeCloseTo(4.1, 5);
  });

  it('is the widest of the labels', () => {
    expect(labelColumnEm(['仮説', 'Success condition'])).toBeCloseTo(9.9, 5);
  });
});
