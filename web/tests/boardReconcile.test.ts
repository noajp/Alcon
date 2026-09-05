//
// What a person sees after a release adds to a surface's default board.
//
// The previous answer was a schema bump, which threw every arrangement away —
// twice in two days. `reconcileBoard` is the replacement: a default singleton
// the stored board predates is folded in at its default place, everything the
// user arranged stays put, and a widget they removed on purpose stays gone.

import { describe, expect, it } from 'vitest';
import { migrateForTest, reconcileBoard } from '@/alcon/widget/useBoard';
import type { BoardLayout } from '@/alcon/widget/types';

const defaults: BoardLayout = {
  band: [],
  main: [
    { id: 'ov-children', type: 'object-children' },
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
    expect(out.main.map((w) => w.type)).toEqual(['object-children', 'milestones']);
  });

  it('does not bring back what the user dismissed', () => {
    const stored: BoardLayout = {
      band: [],
      main: [{ id: 'ov-milestones', type: 'milestones' }],
      rail: [{ id: 'ov-intent', type: 'campaign-intent' }],
    };
    const out = reconcileBoard(
      { layout: stored, dismissed: new Set(['ov-properties', 'ov-children']) },
      defaults,
    );
    expect(out.rail.map((w) => w.type)).toEqual(['campaign-intent', 'intent-trail']);
    expect(out.main.map((w) => w.type)).toEqual(['milestones']);
  });

  it('delivers a new default that is NOT a singleton', () => {
    // Milestones can be held more than once, so a type-keyed rule would never
    // hand this board the default copy it predates.
    const stored: BoardLayout = { band: [], main: [{ id: 'ov-children', type: 'object-children' }], rail: [] };
    const out = reconcileBoard({ layout: stored, dismissed: new Set() }, defaults);
    expect(out.main.map((w) => w.id)).toEqual(['ov-children', 'ov-milestones']);
  });

  it('leaves a user-added second copy of a non-singleton alone', () => {
    const stored: BoardLayout = {
      band: [],
      main: [
        { id: 'ov-children', type: 'object-children' },
        { id: 'ov-milestones', type: 'milestones' },
        { id: 'milestones-abc123', type: 'milestones' }, // added from the picker
      ],
      rail: [],
    };
    const out = reconcileBoard({ layout: stored, dismissed: new Set() }, defaults);
    expect(out.main.map((w) => w.id)).toEqual(['ov-children', 'ov-milestones', 'milestones-abc123']);
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

describe('renamed widget types', () => {
  it('rewrites the two chart widgets into the breakdown they became', () => {
    // A board saved before the collapse names `status-chart`. Dropping it as
    // an unknown type would take the chart off every board that had one.
    const stored = {
      version: 2,
      zones: {
        band: [],
        main: [
          { id: 'home-status', type: 'status-chart', size: 'half' },
          { id: 'home-priority', type: 'priority-chart', size: 'half' },
        ],
        rail: [],
      },
    };
    const layout = migrateForTest(stored);
    expect(layout).not.toBeNull();
    expect(layout!.main.map((w) => [w.type, w.params])).toEqual([
      ['breakdown', { dimension: 'status', shape: 'bar' }],
      ['breakdown', { dimension: 'priority', shape: 'donut' }],
    ]);
    // Placement is untouched: same ids, same order, same widths.
    expect(layout!.main.map((w) => [w.id, w.size])).toEqual([
      ['home-status', 'half'],
      ['home-priority', 'half'],
    ]);
  });
});


describe('board JSON boundary', () => {
  it('drops inherited object keys instead of crashing on API-provided types', () => {
    expect(migrateForTest({ version: 2, zones: { band: [], main: [
      { id: 'x', type: 'constructor' }, { id: 'y', type: '__proto__' },
      { id: 'z', type: 'toString' },
    ], rail: [] } })).toEqual({ band: [], main: [], rail: [] });
  });
});
