import type { WidgetDefinition, WidgetConfig } from './types';

/**
 * Widget Registry — single source of truth for available widgets.
 */
export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  'kpi-cards': {
    type: 'kpi-cards',
    label: 'KPI Cards',
    description: 'Completion, Active, Overdue, Hours efficiency',
    defaultSpan: 'full',
    scopes: ['home', 'object-summary'],
  },
  'status-chart': {
    type: 'status-chart',
    label: 'Status Distribution',
    description: 'Bar breakdown by status',
    defaultSpan: 'half',
    scopes: ['home', 'object-summary'],
  },
  'priority-chart': {
    type: 'priority-chart',
    label: 'Priority Breakdown',
    description: 'Donut chart by priority',
    defaultSpan: 'half',
    scopes: ['home', 'object-summary'],
  },
  'object-progress': {
    type: 'object-progress',
    label: 'Object Progress',
    description: 'Stacked progress bars for each top-level object',
    defaultSpan: 'full',
    scopes: ['home'],
  },
  'overdue-list': {
    type: 'overdue-list',
    label: 'Overdue',
    description: 'Items past their due date',
    defaultSpan: 'half',
    scopes: ['home', 'object-summary'],
  },
  'upcoming-list': {
    type: 'upcoming-list',
    label: 'Upcoming 7 Days',
    description: 'Items due in the next week',
    defaultSpan: 'half',
    scopes: ['home', 'object-summary'],
  },
  'okr-summary': {
    type: 'okr-summary',
    label: 'OKR Summary',
    description: 'Avg progress, on-track count, KR count',
    defaultSpan: 'full',
    scopes: ['overview'],
  },
  'objective-cards': {
    type: 'objective-cards',
    label: 'Objectives',
    description: 'Objective cards with key results',
    defaultSpan: 'full',
    scopes: ['overview'],
  },
  'mini-gantt': {
    type: 'mini-gantt',
    label: 'Mini Gantt',
    description: 'Compact timeline preview',
    defaultSpan: 'full',
    scopes: ['home', 'object-summary'],
  },
  'mini-calendar': {
    type: 'mini-calendar',
    label: 'Mini Calendar',
    description: 'Current month calendar preview',
    defaultSpan: 'half',
    scopes: ['home', 'object-summary'],
  },
};

/**
 * Default widget layouts per scope
 */
export const DEFAULT_LAYOUTS: Record<string, WidgetConfig[]> = {
  home: [
    { id: 'home-kpi', type: 'kpi-cards', span: 'full' },
    { id: 'home-status', type: 'status-chart', span: 'half' },
    { id: 'home-priority', type: 'priority-chart', span: 'half' },
    { id: 'home-objects', type: 'object-progress', span: 'full' },
    { id: 'home-overdue', type: 'overdue-list', span: 'half' },
    { id: 'home-upcoming', type: 'upcoming-list', span: 'half' },
  ],
  'object-summary': [
    { id: 'sum-kpi', type: 'kpi-cards', span: 'full' },
    { id: 'sum-status', type: 'status-chart', span: 'half' },
    { id: 'sum-priority', type: 'priority-chart', span: 'half' },
    { id: 'sum-overdue', type: 'overdue-list', span: 'half' },
    { id: 'sum-upcoming', type: 'upcoming-list', span: 'half' },
  ],
  overview: [
    { id: 'ov-summary', type: 'okr-summary', span: 'full' },
    { id: 'ov-objectives', type: 'objective-cards', span: 'full' },
  ],
};

export function getAvailableWidgetsForScope(
  scope: 'home' | 'object-summary' | 'overview',
): WidgetDefinition[] {
  return Object.values(WIDGET_REGISTRY).filter((w) => w.scopes.includes(scope));
}
