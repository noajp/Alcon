//
// What a person sees after a release adds to a surface's default board.
//
// The previous answer was a schema bump, which threw every arrangement away —
// twice in two days. `reconcileBoard` is the replacement: a default singleton
// the stored board predates is folded in at its default place, everything the
// user arranged stays put, and a widget they removed on purpose stays gone.

import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  boardLayout,
  layoutFromRows,
  movePosition,
  positionBetween,
  reconcileBoard,
  unplacedDefaults,
  type BoardRows,
  type PlacementRow,
} from '@/Function/widget/boardModel';
import type { BoardLayout } from '@/Function/widget/types';

const defaults: BoardLayout = {
  band: [],
  main: [
    { id: 'ov-note', type: 'linked-note' },
    { id: 'ov-milestones', type: 'milestones' },
  ],
  rail: [
    { id: 'ov-intent', type: 'campaign-intent' },
    { id: 'ov-trail', type: 'intent-trail' },
    { id: 'ov-properties', type: 'object-properties' },
  ],
};

describe('reconcileBoard', () => {
  it('inserts a new default singleton at its default index, keeping the arrangement', () => {
    // A board saved before intent-trail existed, with Properties moved above intent.
    const stored: BoardLayout = {
      band: [],
      main: [{ id: 'ov-milestones', type: 'milestones' }],
      rail: [
        { id: 'ov-properties', type: 'object-properties' },
        { id: 'ov-intent', type: 'campaign-intent' },
      ],
    };
    const out = reconcileBoard({ layout: stored, dismissed: new Set() }, defaults);
    expect(out.rail.map((w) => w.type)).toEqual([
      'object-properties',
      'intent-trail',
      'campaign-intent',
    ]);
    // A non-singleton default (milestones is already there anyway) and a
    // singleton the user placed are left exactly as arranged.
    expect(out.main.map((w) => w.type)).toEqual(['linked-note', 'milestones']);
  });

  it('does not bring back what the user dismissed', () => {
    const stored: BoardLayout = {
      band: [],
      main: [{ id: 'ov-milestones', type: 'milestones' }],
      rail: [{ id: 'ov-intent', type: 'campaign-intent' }],
    };
    const out = reconcileBoard(
      { layout: stored, dismissed: new Set(['ov-properties', 'ov-note']) },
      defaults,
    );
    expect(out.rail.map((w) => w.type)).toEqual(['campaign-intent', 'intent-trail']);
    expect(out.main.map((w) => w.type)).toEqual(['milestones']);
  });

  it('delivers a new default that is NOT a singleton', () => {
    // Milestones can be held more than once, so a type-keyed rule would never
    // hand this board the default copy it predates.
    const stored: BoardLayout = { band: [], main: [{ id: 'ov-note', type: 'linked-note' }], rail: [] };
    const out = reconcileBoard({ layout: stored, dismissed: new Set() }, defaults);
    expect(out.main.map((w) => w.id)).toEqual(['ov-note', 'ov-milestones']);
  });

  it('leaves a user-added second copy of a non-singleton alone', () => {
    const stored: BoardLayout = {
      band: [],
      main: [
        { id: 'ov-note', type: 'linked-note' },
        { id: 'ov-milestones', type: 'milestones' },
        { id: 'milestones-abc123', type: 'milestones' }, // added from the picker
      ],
      rail: [],
    };
    const out = reconcileBoard({ layout: stored, dismissed: new Set() }, defaults);
    expect(out.main.map((w) => w.id)).toEqual(['ov-note', 'ov-milestones', 'milestones-abc123']);
  });

  it('counts a singleton as placed wherever it sits, even under a new id', () => {
    // Removed from the rail and re-added through the picker: the default id is
    // gone, but a second copy of a singleton must not appear.
    const stored: BoardLayout = {
      band: [],
      main: [{ id: 'intent-trail-xyz', type: 'intent-trail' }],
      rail: [],
    };
    const out = reconcileBoard({ layout: stored, dismissed: new Set() }, defaults);
    expect(out.main.filter((w) => w.type === 'intent-trail')).toHaveLength(1);
    expect(out.rail.filter((w) => w.type === 'intent-trail')).toHaveLength(0);
  });

  it('returns the same layout object when nothing is missing', () => {
    const out = reconcileBoard({ layout: defaults, dismissed: new Set() }, defaults);
    expect(out).toBe(defaults);
  });
});

// What other people and other builds wrote to a shared board, read back.
const row = (over: Partial<PlacementRow> & { kind?: string | null }): PlacementRow => {
  const { kind = 'milestones', ...rest } = over;
  const widget_id = rest.widget_id ?? `w-${rest.id ?? 'x'}`;
  return {
    id: 'p', widget_id, zone: 'main', position: 1, size: null, default_id: null,
    widget: kind === null ? null : { id: widget_id, kind, params: null },
    ...rest,
  };
};
const rows = (placements: PlacementRow[], dismissed: string[] = []): BoardRows =>
  ({ id: 'board', dismissed_defaults: dismissed, board_placements: placements });

describe('layoutFromRows', () => {
  it('orders by position and addresses a default by its default id', () => {
    const { layout } = layoutFromRows(rows([
      row({ id: 'b', position: 2, kind: 'linked-note' }),
      row({ id: 'a', position: 1, default_id: 'ov-milestones' }),
    ]));
    expect(layout.main.map((w) => [w.id, w.type, w.placementId])).toEqual([
      ['ov-milestones', 'milestones', 'a'],
      ['w-b', 'linked-note', 'b'],
    ]);
  });

  it('drops kinds this build cannot render, including inherited object keys', () => {
    const { layout } = layoutFromRows(rows([
      row({ id: 'a', kind: 'unavailable-widget' }),
      row({ id: 'b', kind: 'constructor' }),
      row({ id: 'c', kind: '__proto__' }),
      row({ id: 'd', zone: 'nowhere' }),
      row({ id: 'e', kind: 'linked-note', size: 'half' }),
    ]));
    expect(layout.main.map(({ id, type, size }) => ({ id, type, size }))).toEqual([
      { id: 'w-e', type: 'linked-note', size: 'half' },
    ]);
  });

  it('keeps one copy of a singleton', () => {
    const { layout } = layoutFromRows(rows([
      row({ id: 'a', zone: 'rail', kind: 'object-properties' }),
      row({ id: 'b', zone: 'rail', position: 2, kind: 'object-properties' }),
    ]));
    expect(layout.rail).toHaveLength(1);
  });

  it('keeps the place of a widget the viewer cannot see, and nothing else about it', () => {
    const { layout } = layoutFromRows(rows([row({ id: 'a', kind: null, widget_id: 'secret' })]));
    expect(layout.main).toEqual([
      { id: 'secret', type: '', hidden: true, size: undefined, widgetId: 'secret', placementId: 'a', position: 1 },
    ]);
  });
});

describe('a board before and after its first edit', () => {
  it('shows the defaults when nothing is stored, all of them unplaced', () => {
    const layout = boardLayout(null, defaults);
    expect(layout).toEqual(defaults);
    expect(unplacedDefaults(layout).map((d) => [d.default_id, d.zone, d.position])).toEqual([
      ['ov-note', 'main', 1], ['ov-milestones', 'main', 2],
      ['ov-intent', 'rail', 1], ['ov-trail', 'rail', 2], ['ov-properties', 'rail', 3],
    ]);
  });

  it('positions a default the board predates between the neighbours it is shown among', () => {
    // Stored: Properties (10) above intent (20). intent-trail is folded in at
    // its default index — between them — and must be written there.
    const layout = boardLayout(rows([
      row({ id: 'a', zone: 'rail', position: 10, default_id: 'ov-properties', kind: 'object-properties' }),
      row({ id: 'b', zone: 'rail', position: 20, default_id: 'ov-intent', kind: 'campaign-intent' }),
      row({ id: 'c', position: 5, default_id: 'ov-milestones' }),
    ], ['ov-note']), defaults);
    expect(unplacedDefaults(layout)).toEqual([
      { default_id: 'ov-trail', kind: 'intent-trail', zone: 'rail', position: 15, size: null, params: {}, singleton: true },
    ]);
  });

  it('leaves nothing to write once every default has a row or was dismissed', () => {
    const layout = boardLayout(rows([row({ id: 'a', default_id: 'ov-milestones' })],
      ['ov-note', 'ov-intent', 'ov-trail', 'ov-properties']), defaults);
    expect(unplacedDefaults(layout)).toEqual([]);
  });
});

describe('positions', () => {
  it('lands between neighbours and past either edge', () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(3, undefined)).toBe(4);
    expect(positionBetween(undefined, 3)).toBe(2);
    expect(positionBetween(undefined, undefined)).toBe(1);
  });

  it('counts the target index without the widget being moved', () => {
    const { layout } = layoutFromRows(rows([
      row({ id: 'a', position: 1 }), row({ id: 'b', position: 2 }), row({ id: 'c', position: 3 }),
    ]));
    // Dragging the first onto the last's slot: it lands after the last.
    expect(movePosition(layout, 'w-a', 'main', 2)).toBe(4);
    expect(movePosition(layout, 'w-c', 'main', 0)).toBe(0);
    expect(movePosition(layout, 'w-a', 'main', 1)).toBe(2.5);
    expect(movePosition(layout, 'w-a', 'rail', 0)).toBe(1);
  });
});

describe('applyEdit', () => {
  const stored = layoutFromRows(rows([
    row({ id: 'a', position: 1, kind: 'linked-note' }),
    row({ id: 'b', position: 2 }),
    row({ id: 'c', zone: 'rail', kind: 'object-properties' }),
    row({ id: 'd', zone: 'rail', position: 2, kind: null, widget_id: 'secret' }),
  ])).layout;

  it('moves within a zone and refuses a zone the widget does not fit', () => {
    expect(applyEdit(stored, { op: 'move', id: 'w-b', zone: 'main', index: 0 }, defaults).main.map((w) => w.id))
      .toEqual(['w-b', 'w-a']);
    expect(applyEdit(stored, { op: 'move', id: 'w-c', zone: 'band', index: 0 }, defaults)).toBe(stored);
  });

  it('keeps a hidden widget in the zone it was placed in', () => {
    expect(applyEdit(stored, { op: 'move', id: 'secret', zone: 'main', index: 0 }, defaults)).toBe(stored);
    expect(applyEdit(stored, { op: 'move', id: 'secret', zone: 'rail', index: 0 }, defaults).rail.map((w) => w.id))
      .toEqual(['secret', 'w-c']);
  });

  it('merges params over what is there and resets to the defaults', () => {
    const once = applyEdit(stored, { op: 'params', id: 'w-b', params: { a: 1 } }, defaults);
    const twice = applyEdit(once, { op: 'params', id: 'w-b', params: (current) => ({ b: Number(current.a) + 1 }) }, defaults);
    expect(twice.main[1].params).toEqual({ a: 1, b: 2 });
    expect(applyEdit(stored, { op: 'remove', id: 'w-a' }, defaults).main.map((w) => w.id)).toEqual(['w-b']);
  });

  it('leaves a hidden widget on the board through a remove and a reset', () => {
    expect(applyEdit(stored, { op: 'remove', id: 'secret' }, defaults)).toBe(stored);
    const reset = applyEdit(stored, { op: 'reset' }, defaults);
    expect(reset.main).toEqual(defaults.main);
    expect(reset.rail.map((w) => w.id)).toEqual([...defaults.rail.map((w) => w.id), 'secret']);
  });
});
