import { type BoardLayout } from './types';

// =============================================================
// Default boards — what a surface looks like before anyone arranges it.
//
// The rule these follow: a default board reproduces the surface as it was
// hand-written, block for block. Turning a screen into a board must not
// change what it looks like — the only difference on day one is that the
// blocks can now be moved, removed, and added to.
// =============================================================

/** Object Overview. The spine (icon / title / description) is not a widget. */
export const OBJECT_OVERVIEW_BOARD: BoardLayout = {
  // The summary line under the name: how much is done and what is still open.
  band: [{ id: 'ov-progress', type: 'progress-band' }],
  main: [
    { id: 'ov-milestones', type: 'milestones' },
    { id: 'ov-attachments', type: 'attachments' },
  ],
  rail: [
    // Intent above Properties: opening an Object should answer what it is
    // trying to win before it answers who owns it and when it is due.
    { id: 'ov-approaches', type: 'approach-references' },
    { id: 'ov-intent', type: 'campaign-intent' },
    // The return leg. The Strategy's written intent says why this Object
    // exists in prose; this says which decisions and assumptions actually
    // reach it, and whether any of them needs somebody today.
    { id: 'ov-trail', type: 'intent-trail' },
    { id: 'ov-properties', type: 'object-properties' },
  ],
};

/**
 * Element detail. The rail's Properties / Labels / Activity islands are still
 * hand-placed — this board holds only what was missing: the decisions and
 * assumptions this Element is standing on, which is the reading an Element
 * could never give before.
 */
export const ELEMENT_DETAIL_BOARD: BoardLayout = {
  band: [],
  main: [],
  rail: [{ id: 'el-trail', type: 'intent-trail' }],
};

/** Home dashboard. Two-column main zone, no rail. */
export const HOME_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'home-kpi', type: 'kpi-cards', size: 'full' },
    { id: 'home-status', type: 'breakdown', size: 'half', params: { dimension: 'status', shape: 'bar' } },
    { id: 'home-priority', type: 'breakdown', size: 'half', params: { dimension: 'priority', shape: 'donut' } },
    { id: 'home-objects', type: 'object-progress', size: 'full' },
    { id: 'home-overdue', type: 'overdue-list', size: 'half' },
    { id: 'home-upcoming', type: 'upcoming-list', size: 'half' },
  ],
  rail: [],
};

/**
 * Strategy detail — one page. The work the page draws already says how far
 * it is, so the band starts empty; under the work, the Tables its AI runs
 * keep (hidden until there is one).
 * Success conditions, premises, decisions and the rest are widgets someone
 * adds when they want them.
 */
export const INITIATIVE_BOARD: BoardLayout = {
  band: [],
  main: [{ id: 'cmp-tables', type: 'data-view' }],
  rail: [],
};

/** Object Summary tab. */
export const OBJECT_SUMMARY_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'sum-kpi', type: 'kpi-cards', size: 'full' },
    { id: 'sum-status', type: 'breakdown', size: 'half', params: { dimension: 'status', shape: 'bar' } },
    { id: 'sum-priority', type: 'breakdown', size: 'half', params: { dimension: 'priority', shape: 'donut' } },
    { id: 'sum-overdue', type: 'overdue-list', size: 'half' },
    { id: 'sum-upcoming', type: 'upcoming-list', size: 'half' },
  ],
  rail: [],
};

/** Domain identity is the spine; execution and strategic relationships are movable. */
export const DOMAIN_OVERVIEW_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'domain-approaches', type: 'domain-approaches' },
    { id: 'domain-initiatives', type: 'domain-initiatives' },
    { id: 'domain-kpi', type: 'kpi-cards' },
    { id: 'domain-objects', type: 'domain-objects' },
  ],
  rail: [],
};
