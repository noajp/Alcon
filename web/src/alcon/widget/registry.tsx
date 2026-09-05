'use client';

import { lazy } from 'react';
import { normalizeDataViewParams } from './widgets/dataViewModel';
import { DIMENSIONS, type Dimension } from '@/alcon/shared/dimensions';
import type { WidgetComponent, WidgetDefinition, WidgetHost } from './types';

/** What "where are the people" asks, and the flow's default question. */
const DEFAULT_FLOW: Dimension[] = ['assignee', 'object', 'campaign'];

// =============================================================
// Widget registry — the catalogue, and the only place a widget's module is
// named.
//
// Each definition owns its own `import()`. That is what removed the central
// `renderWidget` switch: adding a widget no longer means editing a shared
// file that every widget's bundle then hangs off. Code splitting is the
// default rather than something recharts had to be special-cased into.
//
// `load()` also does the prop adaptation, so the widget bodies stay plainly
// typed on their own inputs (`elements`, `explorerData`) instead of every one
// of them reaching into a host object it mostly ignores.
// =============================================================

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  'data-view': {
    type: 'data-view',
    label: 'Data',
    description: 'Your table data as editable rows, grouped cards, or a chart',
    group: 'core',
    accepts: ['me', 'domain', 'object', 'element', 'campaign', 'phase'],
    zones: ['main', 'rail'],
    defaultSize: 'full',
    normalizeParams: normalizeDataViewParams,
    load: async () => (await import('./widgets/DataViewWidget')).DataViewWidget,
  },
  // ─── Core — what the subject IS ───────────────────────────
  'object-properties': {
    type: 'object-properties',
    label: 'Properties',
    description: 'Type, dates, lead, progress',
    group: 'core',
    accepts: ['object'],
    zones: ['rail', 'main'],
    singleton: true,
    padded: false,
    load: async () => {
      const { ObjectPropertiesWidget } = await import('./widgets/ObjectPropertiesWidget');
      return ObjectPropertiesWidget;
    },
  },
  'campaign-intent': {
    type: 'campaign-intent',
    label: 'Campaign intent',
    description: 'Why this exists, from the Campaign it feeds',
    group: 'core',
    accepts: ['object'],
    zones: ['rail', 'main'],
    singleton: true,
    padded: false,
    load: async () => {
      const { CampaignIntentWidget } = await import('./widgets/CampaignIntentWidget');
      return CampaignIntentWidget;
    },
  },
  'linked-note': {
    type: 'linked-note',
    label: 'Linked Note',
    description: 'Pin a Note to this Object',
    group: 'core',
    accepts: ['object'],
    zones: ['main'],
    singleton: true,
    padded: false,
    defaultSize: 'full',
    load: async () => {
      const { LinkedNoteWidget } = await import('./widgets/LinkedNoteWidget');
      return LinkedNoteWidget;
    },
  },

  'campaign-situation': {
    type: 'campaign-situation',
    label: 'Situation',
    description: 'Whether this Campaign is going to land',
    group: 'core',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { CampaignSituationWidget } = await import('./widgets/CampaignSituationWidget');
      return CampaignSituationWidget;
    },
  },
  'campaign-risk': {
    type: 'campaign-risk',
    label: 'Risk & Load',
    description: 'Which Object is hurting, and who is carrying it',
    group: 'core',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { CampaignRiskWidget } = await import('./widgets/CampaignRiskWidget');
      return CampaignRiskWidget;
    },
  },

  'intent-trail': {
    type: 'intent-trail',
    label: 'Decisions & assumptions',
    description: 'What this is standing on, and the Campaign it belongs to',
    group: 'core',
    // Not `phase` yet: PhaseView hand-renders the decisions that moved its
    // dates (`usePhaseReschedules`), and accepting the subject before that
    // section becomes this widget would show the same rows twice.
    accepts: ['element', 'object'],
    zones: ['rail', 'main'],
    singleton: true,
    padded: false,
    load: async () => {
      const { IntentTrailWidget } = await import('./widgets/IntentTrailWidget');
      return IntentTrailWidget;
    },
  },

  'effort-flow': {
    type: 'effort-flow',
    label: 'Where the people are',
    description: 'Assignments flowing from Worker to Object to Campaign',
    group: 'chart',
    accepts: ['me', 'campaign', 'domain', 'object'],
    zones: ['main'],
    singleton: true,
    padded: false,
    defaultSize: 'full',
    normalizeParams: (raw) => {
      const wanted = Array.isArray(raw?.dimensions) ? raw.dimensions : [];
      const dimensions = wanted.filter((d): d is Dimension =>
        typeof d === 'string' && (DIMENSIONS as string[]).includes(d),
      );
      // Two columns is the minimum a flow means anything at; the default is
      // the question this widget was built to answer.
      return { dimensions: dimensions.length >= 2 ? dimensions.slice(0, 3) : DEFAULT_FLOW };
    },
    load: async () => {
      const { EffortFlowWidget } = await import('./widgets/EffortFlowWidget');
      return EffortFlowWidget;
    },
  },

  // ─── Frameworks — lenses over rows the board already holds ─────
  // Frameworks read persistent source rows. Campaign lenses use intents;
  // user-defined categories and fields use Table data through data-view.
  'framework-okr': {
    type: 'framework-okr',
    label: 'OKR',
    description: 'The Campaign cascade, with its measures as key results',
    group: 'plan',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    padded: false,
    defaultSize: 'full',
    load: async () => {
      const { FrameworkOkrWidget } = await import('./widgets/FrameworkOkrWidget');
      return FrameworkOkrWidget;
    },
  },
  'framework-gap': {
    type: 'framework-gap',
    label: 'Gap analysis',
    description: 'How far each reading is from the condition it is judged against',
    group: 'plan',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    padded: false,
    defaultSize: 'full',
    load: async () => {
      const { FrameworkGapWidget } = await import('./widgets/FrameworkGapWidget');
      return FrameworkGapWidget;
    },
  },

  // The three sections a Campaign is written by hand. Order in the default
  // board runs outward-in, and that ordering is the reason it is a default
  // rather than a rule: Measures first because the conditions are usually set
  // by somebody outside the Campaign and whether they are met is the question
  // a reader arrives with; Assumptions next, being what the plan takes as
  // given and what invalidates everything below when shaken; Decisions last,
  // because a choice read without the ground under it looks arbitrary.
  'campaign-measures': {
    type: 'campaign-measures',
    label: 'Measures',
    description: 'The conditions this Campaign is held to',
    group: 'core',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { CampaignMeasuresWidget } = await import('./widgets/CampaignMeasuresWidget');
      return CampaignMeasuresWidget;
    },
  },
  'campaign-assumptions': {
    type: 'campaign-assumptions',
    label: 'Assumptions',
    description: 'What the plan takes as given',
    group: 'core',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { CampaignAssumptionsWidget } = await import('./widgets/CampaignAssumptionsWidget');
      return CampaignAssumptionsWidget;
    },
  },
  'campaign-decisions': {
    type: 'campaign-decisions',
    label: 'Decisions',
    description: 'What was chosen, and when it is due for review',
    group: 'core',
    accepts: ['campaign'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { CampaignDecisionsWidget } = await import('./widgets/CampaignDecisionsWidget');
      return CampaignDecisionsWidget;
    },
  },

  // ─── Progress — how it is going ───────────────────────────
  'progress-band': {
    type: 'progress-band',
    label: 'Progress',
    description: 'Completion across the whole subject, as a bar',
    group: 'progress',
    accepts: ['object', 'me', 'campaign', 'phase'],
    zones: ['band', 'main', 'rail'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { ProgressBandWidget } = await import('./widgets/ProgressBandWidget');
      return ProgressBandWidget;
    },
  },
  'kpi-cards': {
    type: 'kpi-cards',
    label: 'Key numbers',
    description: 'Completion, active, overdue, hours',
    group: 'progress',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main'],
    singleton: true,
    padded: false,
    defaultSize: 'full',
    load: async () => {
      const { KpiCardsWidget } = await import('./widgets/KpiCardsWidget');
      return adapt((host) => <KpiCardsWidget elements={host.elements} />);
    },
  },
  'object-progress': {
    type: 'object-progress',
    label: 'Object progress',
    description: 'A bar per Object in the Space',
    group: 'progress',
    accepts: ['me'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { ObjectProgressWidget } = await import('./widgets/ObjectProgressWidget');
      return adapt((host) =>
        host.explorerData ? <ObjectProgressWidget explorerData={host.explorerData} /> : null,
      );
    },
  },

  // ─── Plan — when ──────────────────────────────────────────
  milestones: {
    type: 'milestones',
    label: 'Milestones',
    description: 'High-priority Elements with due dates',
    group: 'plan',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main', 'rail'],
    defaultSize: 'full',
    load: async () => {
      const { MilestonesWidget } = await import('./widgets/MilestonesWidget');
      return adapt((host) => <MilestonesWidget elements={host.elements} />);
    },
  },
  'mini-gantt': {
    type: 'mini-gantt',
    label: 'Mini Gantt',
    description: 'Compact timeline preview',
    group: 'plan',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main'],
    defaultSize: 'full',
    load: async () => {
      const { MiniGanttWidget } = await import('./widgets/MiniGanttWidget');
      return adapt((host) => <MiniGanttWidget elements={host.elements} />);
    },
  },
  'mini-calendar': {
    type: 'mini-calendar',
    label: 'Mini calendar',
    description: 'Current month, with due dates marked',
    group: 'plan',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main', 'rail'],
    load: async () => {
      const { MiniCalendarWidget } = await import('./widgets/MiniCalendarWidget');
      return adapt((host) => <MiniCalendarWidget elements={host.elements} />);
    },
  },

  // ─── Charts ───────────────────────────────────────────────

  breakdown: {
    type: 'breakdown',
    label: 'Breakdown',
    description: 'How many, counted by whichever column you choose',
    group: 'chart',
    accepts: ['object', 'me', 'campaign', 'domain'],
    zones: ['main', 'rail'],
    padded: false,
    normalizeParams: (raw) => {
      const dimension = (DIMENSIONS as string[]).includes(raw?.dimension as string)
        ? (raw?.dimension as Dimension)
        : 'status';
      const shape = raw?.shape === 'donut' ? 'donut' : 'bar';
      return { dimension, shape };
    },
    load: async () => {
      const { BreakdownWidget } = await import('./widgets/BreakdownWidget');
      return BreakdownWidget;
    },
  },

  // ─── Lists ────────────────────────────────────────────────
  'overdue-list': {
    type: 'overdue-list',
    label: 'Overdue',
    description: 'Elements past their due date',
    group: 'list',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main', 'rail'],
    load: async () => {
      const { OverdueWidget } = await import('./widgets/OverdueWidget');
      return adapt((host) => <OverdueWidget elements={host.elements} />);
    },
  },
  'upcoming-list': {
    type: 'upcoming-list',
    label: 'Upcoming 7 days',
    description: 'Elements due in the next week',
    group: 'list',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main', 'rail'],
    load: async () => {
      const { UpcomingWidget } = await import('./widgets/UpcomingWidget');
      return adapt((host) => <UpcomingWidget elements={host.elements} />);
    },
  },
  'team-roster': {
    type: 'team-roster',
    label: 'Team',
    description: 'Workers assigned in this scope',
    group: 'list',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main', 'rail'],
    load: async () => {
      const { TeamRosterWidget } = await import('./widgets/TeamRosterWidget');
      return adapt((host) => <TeamRosterWidget elements={host.elements} />);
    },
  },
  'recent-activity': {
    type: 'recent-activity',
    label: 'Recent activity',
    description: 'Latest changes and updates',
    group: 'list',
    accepts: ['object', 'me', 'campaign'],
    zones: ['main', 'rail'],
    load: async () => {
      const { RecentActivityWidget } = await import('./widgets/RecentActivityWidget');
      return adapt((host) => <RecentActivityWidget elements={host.elements} />);
    },
  },
};

/** Wraps a host-shaped render function as a widget component. Used for the
 *  bodies that take no configuration and read only the resolved scope. */
function adapt(render: (host: WidgetHost) => React.ReactNode): WidgetComponent {
  return function AdaptedWidget({ host }) {
    return <>{render(host)}</>;
  };
}

// One lazy component per type, built at module load. `lazy()` does not fetch
// until the component renders, so building the map eagerly costs nothing —
// and it means a zone looks a component up rather than creating one mid-render.
export const WIDGET_COMPONENTS: Record<string, WidgetComponent> =
  Object.fromEntries(
    Object.entries(WIDGET_REGISTRY).map(([type, def]) => [
      type,
      lazy(async () => ({ default: await def.load() })),
    ]),
  );
