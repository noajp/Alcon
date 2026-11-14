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
  // Nothing under the name: a completion bar there read as a score for the
  // Object, which its Elements' board already shows.
  band: [],
  // The document column is fixed on an Object's page (attachments,
  // Milestones, Updates), so the board holds no main zone of its own.
  main: [],
  rail: [
    // Intent above Properties: opening an Object should answer what it is
    // trying to win before it answers who owns it and when it is due.
    { id: 'ov-approaches', type: 'approach-references' },
    { id: 'ov-intent', type: 'campaign-intent' },
    // The return leg. The Strategy's written intent says why this Object
    // exists in prose; this says which decisions, premises and success
    // conditions actually reach it, and whether any of them needs somebody today.
    { id: 'ov-trail', type: 'intent-trail' },
    { id: 'ov-properties', type: 'object-properties' },
  ],
};

/**
 * Element detail. The rail's Properties / Labels / Activity islands are still
 * hand-placed — this board holds only what was missing: why this Element
 * exists — the decisions, premises and success conditions it stands on, or
 * else the Strategies its Objects belong to.
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
  // What a Strategy holds, in the order it is decided: how success is
  // measured, what it takes as true, what was decided. Then its Tables.
  main: [
    { id: 'cmp-measures', type: 'campaign-measures' },
    { id: 'cmp-assumptions', type: 'campaign-assumptions' },
    { id: 'cmp-decisions', type: 'campaign-decisions' },
    { id: 'cmp-tables', type: 'data-view' },
  ],
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
