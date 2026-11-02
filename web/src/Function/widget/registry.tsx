'use client';

import { lazy } from 'react';
import { normalizeOperationsParams } from '@/Function/operations/operationsModel';
import { normalizeDataViewParams } from './widgets/dataViewModel';
import { DIMENSIONS, type Dimension } from '@/Function/shared/dimensions';
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

/** An Artifacts placement's params: no file is every artifact; a file is that one, shown whole, as a chart or as a value. */
function artifactParams(raw: Record<string, unknown> | undefined) {
  return {
    fileId: typeof raw?.fileId === 'string' && raw.fileId.length <= 64 ? raw.fileId : null,
    show: raw?.show === 'chart' || raw?.show === 'value' ? raw.show : 'file',
    chart: Number.isInteger(raw?.chart) && Number(raw?.chart) >= 0 ? raw?.chart : 0,
    sheet: typeof raw?.sheet === 'string' && raw.sheet.length <= 120 ? raw.sheet : null,
    cell: typeof raw?.cell === 'string' && /^[A-Z]{1,3}\d{1,7}$/i.test(raw.cell) ? raw.cell.toUpperCase() : 'A1',
    label: typeof raw?.label === 'string' && raw.label.length <= 80 ? raw.label : null,
  };
}

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  'generated-app': {
    type: 'generated-app', label: 'AI app',
    description: 'Create a persistent calculator, checklist or mini app with AI',
    group: 'core', accepts: ['object'], zones: ['main'], defaultSize: 'full', holdsContents: true,
    load: async () => (await import('./widgets/GeneratedAppWidget')).GeneratedAppWidget,
  },
  'design': {
    type: 'design', label: 'Design',
    description: 'An artboard in HTML and SVG, drawn and revised with AI',
    group: 'core', accepts: ['me', 'domain', 'object', 'initiative'], zones: ['main'], defaultSize: 'full', holdsContents: true,
    load: async () => (await import('./widgets/DesignWidget')).DesignWidget,
  },
  'deck': {
    type: 'deck', label: 'Deck',
    description: 'A Slides deck: its pages here, the full editor when opened full screen',
    group: 'core', accepts: ['me', 'domain', 'object', 'initiative'], zones: ['main'], defaultSize: 'full',
    normalizeParams: (raw) => ({ deckId: typeof raw?.deckId === 'string' && raw.deckId.length <= 64 ? raw.deckId : null }),
    load: async () => (await import('./widgets/DeckWidget')).DeckWidget,
  },
  // One widget for a subject's artifacts: every one, or one pinned (the
  // whole file, a chart, a value). 'file' is the same widget under the type
  // boards placed before the two were one; it is no longer offered.
  'attachments': {
    type: 'attachments', label: 'Artifacts',
    description: 'The artifacts of this Object or Initiative — previewed in place, editable, turned into Notes, Tables or decks — or one of them pinned: the whole file, a chart, or a cell as a key number',
    group: 'core', accepts: ['domain', 'object', 'initiative'], zones: ['main', 'rail'], defaultSize: 'full',
    normalizeParams: artifactParams,
    load: async () => (await import('./widgets/ArtifactsWidget')).ArtifactsWidget,
  },
  'file': {
    type: 'file', label: 'Artifacts', retired: true,
    group: 'core', accepts: ['domain', 'object', 'initiative'], zones: ['main', 'rail'], defaultSize: 'full',
    normalizeParams: artifactParams,
    load: async () => (await import('./widgets/ArtifactsWidget')).ArtifactsWidget,
  },
  'note': {
    type: 'note', label: 'Note',
    description: 'A Note from Notebook, written in place',
    group: 'core', accepts: ['me', 'domain', 'object', 'initiative'], zones: ['main'], defaultSize: 'full', padded: false,
    normalizeParams: (raw) => ({ noteId: typeof raw?.noteId === 'string' && raw.noteId.length <= 64 ? raw.noteId : null }),
    load: async () => (await import('./widgets/NoteWidget')).NoteWidget,
  },
  'crm-deal': {
    type: 'crm-deal', label: 'Deal',
    description: 'A CRM deal: stage, amount, health and next step, changed in place',
    group: 'core', accepts: ['me', 'domain', 'object', 'initiative'], zones: ['main', 'rail'], defaultSize: 'half',
    normalizeParams: (raw) => ({ dealId: typeof raw?.dealId === 'string' && raw.dealId.length <= 64 ? raw.dealId : null }),
    load: async () => (await import('./widgets/CrmDealWidget')).CrmDealWidget,
  },
  'approach-references': {
    type: 'approach-references', label: 'Domain approaches', group: 'core',
    accepts: ['initiative', 'object'], zones: ['main', 'rail'], singleton: true, defaultSize: 'full',
    load: async () => (await import('./widgets/ApproachReferencesWidget')).ApproachReferencesWidget,
  },
  'domain-approaches': {
    type: 'domain-approaches', label: 'Approaches', group: 'core',
    accepts: ['domain'], zones: ['main'], singleton: true, defaultSize: 'full',
    load: async () => (await import('./widgets/DomainApproachesWidget')).DomainApproachesWidget,
  },
  'domain-objects': {
    type: 'domain-objects', label: 'Objects', group: 'core',
    accepts: ['domain'], zones: ['main'], singleton: true, defaultSize: 'full',
    load: async () => (await import('./widgets/DomainObjectsWidget')).DomainObjectsWidget,
  },
  'initiative-domains': {
    type: 'initiative-domains', label: 'Related Domains', group: 'core',
    accepts: ['initiative'], zones: ['main'], singleton: true, defaultSize: 'full',
    load: async () => (await import('./widgets/InitiativeDomainsWidget')).InitiativeDomainsWidget,
  },
  'domain-initiatives': {
    type: 'domain-initiatives', label: 'Related Initiatives', group: 'core',
    accepts: ['domain'], zones: ['main'], singleton: true, defaultSize: 'full',
    load: async () => (await import('./widgets/DomainInitiativesWidget')).DomainInitiativesWidget,
  },
  'operations-planner': {
    type: 'operations-planner',
    label: 'Operations planner',
    description: 'CRM forecasts and follow-ups from a pipeline Table',
    group: 'plan',
    accepts: ['me', 'domain', 'object', 'initiative'],
    zones: ['main'],
    defaultSize: 'full',
    normalizeParams: normalizeOperationsParams,
    load: async () => (await import('./widgets/OperationsPlannerWidget')).default,
  },
  'data-view': {
    type: 'data-view',
    label: 'Data',
    description: 'Your table data as editable rows, grouped cards, or a chart',
    group: 'core',
    accepts: ['me', 'domain', 'object', 'element', 'initiative', 'phase'],
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
    label: 'Initiative intent',
    description: 'Why this exists, from the Initiative it feeds',
    group: 'core',
    accepts: ['object'],
    zones: ['rail', 'main'],
    singleton: true,
    padded: false,
    load: async () => {
      const { InitiativeIntentWidget } = await import('./widgets/InitiativeIntentWidget');
      return InitiativeIntentWidget;
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
    description: 'Whether this Initiative is going to land',
    group: 'core',
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { InitiativeSituationWidget } = await import('./widgets/InitiativeSituationWidget');
      return InitiativeSituationWidget;
    },
  },
  'decision-lab': {
    type: 'decision-lab',
    label: 'Decision Lab',
    description: 'Compare ways to protect a commitment and see the cost to other work',
    group: 'plan',
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { DecisionLabWidget } = await import('./widgets/DecisionLabWidget');
      return DecisionLabWidget;
    },
  },
  'campaign-risk': {
    type: 'campaign-risk',
    label: 'Risk & Load',
    description: 'Which Object is hurting, and who is carrying it',
    group: 'core',
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { InitiativeRiskWidget } = await import('./widgets/InitiativeRiskWidget');
      return InitiativeRiskWidget;
    },
  },

  'intent-trail': {
    type: 'intent-trail',
    label: 'Decisions & assumptions',
    description: 'What this is standing on, and the Initiative it belongs to',
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
    description: 'Assignments flowing from Worker to Object to Initiative',
    group: 'chart',
    accepts: ['me', 'initiative', 'domain', 'object'],
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
  // Frameworks read persistent source rows. Initiative lenses use intents;
  // user-defined categories and fields use Table data through data-view.
  'framework-okr': {
    type: 'framework-okr',
    label: 'OKR',
    description: 'The Initiative cascade, with its measures as key results',
    group: 'plan',
    accepts: ['initiative'],
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
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    padded: false,
    defaultSize: 'full',
    load: async () => {
      const { FrameworkGapWidget } = await import('./widgets/FrameworkGapWidget');
      return FrameworkGapWidget;
    },
  },

  // The three sections a Initiative is written by hand. Order in the default
  // board runs outward-in, and that ordering is the reason it is a default
  // rather than a rule: Measures first because the conditions are usually set
  // by somebody outside the Initiative and whether they are met is the question
  // a reader arrives with; Assumptions next, being what the plan takes as
  // given and what invalidates everything below when shaken; Decisions last,
  // because a choice read without the ground under it looks arbitrary.
  'campaign-measures': {
    type: 'campaign-measures',
    label: 'Measures',
    description: 'The conditions this Initiative is held to',
    group: 'core',
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { InitiativeMeasuresWidget } = await import('./widgets/InitiativeMeasuresWidget');
      return InitiativeMeasuresWidget;
    },
  },
  'campaign-assumptions': {
    type: 'campaign-assumptions',
    label: 'Assumptions',
    description: 'What the plan takes as given',
    group: 'core',
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { InitiativeAssumptionsWidget } = await import('./widgets/InitiativeAssumptionsWidget');
      return InitiativeAssumptionsWidget;
    },
  },
  'campaign-decisions': {
    type: 'campaign-decisions',
    label: 'Decisions',
    description: 'What was chosen, and when it is due for review',
    group: 'core',
    accepts: ['initiative'],
    zones: ['main'],
    singleton: true,
    defaultSize: 'full',
    load: async () => {
      const { InitiativeDecisionsWidget } = await import('./widgets/InitiativeDecisionsWidget');
      return InitiativeDecisionsWidget;
    },
  },

  // ─── Progress — how it is going ───────────────────────────
  'progress-band': {
    type: 'progress-band',
    label: 'Progress',
    description: 'Completion across the whole subject, as a bar',
    group: 'progress',
    accepts: ['object', 'me', 'initiative', 'phase'],
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
    accepts: ['object', 'me', 'initiative', 'domain'],
    zones: ['main'],
    singleton: true,
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
    description: 'Dated markers on this Object, the ◇ on its Gantt',
    group: 'plan',
    accepts: ['object', 'me', 'initiative'],
    zones: ['main', 'rail'],
    defaultSize: 'full',
    load: async () => (await import('./widgets/MilestonesWidget')).MilestonesWidget,
  },
  'mini-gantt': {
    type: 'mini-gantt',
    label: 'Mini Gantt',
    description: 'Compact timeline preview',
    group: 'plan',
    accepts: ['object', 'me', 'initiative'],
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
    accepts: ['object', 'me', 'initiative'],
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
    accepts: ['object', 'me', 'initiative'],
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
    accepts: ['object', 'me', 'initiative'],
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
    accepts: ['object', 'me', 'initiative'],
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
    accepts: ['object', 'me', 'initiative'],
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
    accepts: ['object', 'me', 'initiative'],
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
const lazyWidget = (def: WidgetDefinition): WidgetComponent => lazy(async () => ({ default: await def.load() }));
export const WIDGET_COMPONENTS: Record<string, WidgetComponent> =
  Object.fromEntries(Object.entries(WIDGET_REGISTRY).map(([type, def]) => [type, lazyWidget(def)]));

/**
 * A fresh lazy component for one widget instance's Retry. `lazy()` keeps a
 * rejected load forever, so retrying through the shared component would only
 * rethrow the same failed chunk; a new one calls `load()` again. Built per
 * instance, so other widgets of the same type keep their component (and state).
 */
export function reloadWidgetComponent(type: string): WidgetComponent | null {
  const def = WIDGET_REGISTRY[type];
  return def ? lazyWidget(def) : null;
}
