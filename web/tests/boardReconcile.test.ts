//
// What a person sees after a release adds to a surface's default board.
//
// The previous answer was a schema bump, which threw every arrangement away —
// twice in two days. `reconcileBoard` is the replacement: a default singleton
// the stored board predates is folded in at its default place, everything the
// user arranged stays put, and a widget they removed on purpose stays gone.

import { describe, expect, it } from 'vitest';
import { reconcileBoard } from '@/alcon/widget/useBoard';
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

  it('does not bring back a singleton the user dismissed', () => {
    const stored: BoardLayout = {
      band: [],
      main: [{ id: 'ov-milestones', type: 'milestones' }],
      rail: [{ id: 'ov-intent', type: 'campaign-intent' }],
    };
    const out = reconcileBoard(
      { layout: stored, dismissed: new Set(['object-properties', 'object-children']) },
      defaults,
    );
    expect(out.rail.map((w) => w.type)).toEqual(['campaign-intent', 'intent-trail']);
    expect(out.main.map((w) => w.type)).toEqual(['milestones']);
  });

  it('counts a singleton as placed wherever it sits, not only in its default zone', () => {
    const stored: BoardLayout = {
      band: [],
      main: [{ id: 'x', type: 'intent-trail' }], // moved to main
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
