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
  band: [],
  main: [
    { id: 'ov-children', type: 'object-children' },
    { id: 'ov-milestones', type: 'milestones' },
  ],
  rail: [
    // Intent above Properties: opening an Object should answer what it is
    // trying to win before it answers who owns it and when it is due.
    { id: 'ov-intent', type: 'campaign-intent' },
    { id: 'ov-properties', type: 'object-properties' },
  ],
};

/** Home dashboard. Two-column main zone, no rail. */
export const HOME_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'home-kpi', type: 'kpi-cards', size: 'full' },
    { id: 'home-status', type: 'status-chart', size: 'half' },
    { id: 'home-priority', type: 'priority-chart', size: 'half' },
    { id: 'home-objects', type: 'object-progress', size: 'full' },
    { id: 'home-overdue', type: 'overdue-list', size: 'half' },
    { id: 'home-upcoming', type: 'upcoming-list', size: 'half' },
  ],
  rail: [],
};

/**
 * Campaign detail. The readings sit where the hand-written Situation and Risk
 * sections did — between the description and the Campaign's own structure
 * (Frameworks / Campaigns / Objects / Activity), which is not a board.
 */
export const CAMPAIGN_BOARD: BoardLayout = {
  band: [],
  main: [
    // Situation before Risk: whether it lands is the question someone opened
    // the page with; where it hurts is only actionable once that is known.
    { id: 'cmp-situation', type: 'campaign-situation' },
    { id: 'cmp-risk', type: 'campaign-risk' },
  ],
  rail: [],
};

/** Object Summary tab. */
export const OBJECT_SUMMARY_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'sum-kpi', type: 'kpi-cards', size: 'full' },
    { id: 'sum-status', type: 'status-chart', size: 'half' },
    { id: 'sum-priority', type: 'priority-chart', size: 'half' },
    { id: 'sum-overdue', type: 'overdue-list', size: 'half' },
    { id: 'sum-upcoming', type: 'upcoming-list', size: 'half' },
  ],
  rail: [],
};
