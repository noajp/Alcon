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
    { id: 'ov-milestones', type: 'milestones' },
  ],
  rail: [
    // Intent above Properties: opening an Object should answer what it is
    // trying to win before it answers who owns it and when it is due.
    { id: 'ov-intent', type: 'campaign-intent' },
    // The return leg. The Initiative's written intent says why this Object
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
 * Initiative detail. The readings sit where the hand-written Situation and Risk
 * sections did — between the description and the Initiative's own structure
 * (Frameworks / Initiatives / Objects / Activity), which is not a board.
 */
export const INITIATIVE_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'initiative-domains', type: 'initiative-domains' },
    // Situation before Risk: whether it lands is the question someone opened
    // the page with; where it hurts is only actionable once that is known.
    { id: 'cmp-situation', type: 'campaign-situation' },
    { id: 'cmp-decision-lab', type: 'decision-lab' },
    { id: 'cmp-risk', type: 'campaign-risk' },
    // …and then why. The two above are readings taken off the execution;
    // these three are the only sections anyone writes by hand, and they are
    // the ones that survive the people who wrote them. Outward-in: the
    // conditions the Initiative is held to, then what the plan rests on, then
    // what was chosen on top of it.
    { id: 'cmp-measures', type: 'campaign-measures' },
    // The frameworks read those same measures back — OKR as a cascade of
    // Objectives, Gap as the distance to each condition — so they sit under
    // the section that records them.
    { id: 'cmp-okr', type: 'framework-okr' },
    { id: 'cmp-gap', type: 'framework-gap' },
    { id: 'cmp-assumptions', type: 'campaign-assumptions' },
    { id: 'cmp-decisions', type: 'campaign-decisions' },
  ],
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

/** Business tools use one planner with a different question on each surface. */
export const CRM_BOARD: BoardLayout = {
  band: [],
  main: [{ id: 'crm-planner', type: 'operations-planner', size: 'full', params: { kind: 'crm' } }],
  rail: [],
};

export const SCM_BOARD: BoardLayout = {
  band: [],
  main: [{ id: 'scm-planner', type: 'operations-planner', size: 'full', params: { kind: 'scm' } }],
  rail: [],
};

/** Domain identity is the spine; execution and strategic relationships are movable. */
export const DOMAIN_OVERVIEW_BOARD: BoardLayout = {
  band: [],
  main: [
    { id: 'domain-initiatives', type: 'domain-initiatives' },
    { id: 'domain-kpi', type: 'kpi-cards' },
    { id: 'domain-objects', type: 'domain-objects' },
  ],
  rail: [],
};
