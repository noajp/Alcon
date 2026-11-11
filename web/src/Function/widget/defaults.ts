import { type BoardLayout } from './types';

// =============================================================
// Default boards — what a surface looks like before anyone arranges it.
//
// The rule these follow: a default board reproduces the surface as it was
// hand-written, block for block. Turning a screen into a board must not
// change what it looks like — the only difference on day one is that the
// blocks can now be moved, removed, and added to.
// =============================================================

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
  // The island beside the Overview: the Strategy's facts.
  rail: [{ id: 'cmp-properties', type: 'strategy-properties' }],
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

/** A Domain's Overview is its identity; its Objects are the All Objects tab.
 *  Widgets are what someone adds. */
export const DOMAIN_OVERVIEW_BOARD: BoardLayout = { band: [], main: [], rail: [] };
