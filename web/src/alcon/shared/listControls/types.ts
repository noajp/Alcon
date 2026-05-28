// Filter / Display state shared by every Element-bearing list view (My
// Elements, Domain Elements, Domain Objects). Persisted per-view in
// localStorage under `list-controls:<scope>`.

import type { ElementPriority, ElementStatus } from '@/types/database';

export interface ListFilter {
  /** Status values to include. undefined = no constraint. */
  status?: ElementStatus[];
  /** Priority values to include. undefined = no constraint. */
  priority?: ElementPriority[];
  /** Element `type` values to include (Domain-shared catalogue). */
  types?: string[];
  /** Label strings to include — match if the Element has ANY of these. */
  labels?: string[];
  /** Worker ids whose Elements should be included via element_assignees. */
  assigneeWorkerIds?: string[];
  /** Restrict to Elements I personally own (`owner_id = me`). */
  ownerOnly?: boolean;
  /** Restrict to Elements that live under one of these Objects. */
  objectIds?: string[];
  /** Inclusive lower bound on `due_date` (YYYY-MM-DD). */
  dueFrom?: string | null;
  /** Inclusive upper bound on `due_date` (YYYY-MM-DD). */
  dueTo?: string | null;
  /** Substring match against `title` (case-insensitive). */
  query?: string;
}

export type ListGroupBy =
  | 'none'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'type'
  | 'label'
  | 'date_week'
  | 'date_month';

export type ListOrderBy =
  | 'manual'
  | 'priority'
  | 'due'
  | 'created'
  | 'updated'
  | 'title';

export interface ListDisplay {
  groupBy: ListGroupBy;
  orderBy: ListOrderBy;
  /** Direction for `orderBy`. 'asc' reads naturally for due / title /
   *  created / updated; 'desc' makes priority list Urgent → Low. */
  orderDir: 'asc' | 'desc';
}

export interface ListControlsState {
  filter: ListFilter;
  display: ListDisplay;
}

export const DEFAULT_FILTER: ListFilter = {
  status: undefined,
  priority: undefined,
  types: undefined,
  labels: undefined,
  assigneeWorkerIds: undefined,
  ownerOnly: false,
  objectIds: undefined,
  dueFrom: null,
  dueTo: null,
  query: '',
};

export const DEFAULT_DISPLAY: ListDisplay = {
  groupBy: 'none',
  orderBy: 'manual',
  orderDir: 'asc',
};

export const DEFAULT_STATE: ListControlsState = {
  filter: DEFAULT_FILTER,
  display: DEFAULT_DISPLAY,
};

const STATUS_LABEL: Record<ElementStatus, string> = {
  backlog:     'Backlog',
  todo:        'Todo',
  in_progress: 'In Progress',
  review:      'Review',
  done:        'Done',
  blocked:     'Blocked',
  cancelled:   'Cancelled',
};
const PRIORITY_LABEL: Record<ElementPriority, string> = {
  urgent: 'Urgent',
  high:   'High',
  medium: 'Medium',
  low:    'Low',
};
export const STATUS_OPTIONS: ElementStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked', 'cancelled'];
export const PRIORITY_OPTIONS: ElementPriority[] = ['urgent', 'high', 'medium', 'low'];
export const labelForStatus   = (s: ElementStatus): string   => STATUS_LABEL[s];
export const labelForPriority = (p: ElementPriority): string => PRIORITY_LABEL[p];

const PRIORITY_WEIGHT: Record<ElementPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
export const priorityWeight = (p: ElementPriority | null | undefined): number =>
  p ? PRIORITY_WEIGHT[p] : 0;

export function loadState(scope: string): ListControlsState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(`list-controls:${scope}`);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<ListControlsState>;
    return {
      filter:  { ...DEFAULT_FILTER,  ...(parsed.filter ?? {}) },
      display: { ...DEFAULT_DISPLAY, ...(parsed.display ?? {}) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveState(scope: string, state: ListControlsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`list-controls:${scope}`, JSON.stringify(state));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** True when any filter field is set away from its default. Used to render
 *  the active-dot indicator on the Filter button. */
export function hasActiveFilter(f: ListFilter): boolean {
  return Boolean(
    (f.status?.length ?? 0)  ||
    (f.priority?.length ?? 0) ||
    (f.types?.length ?? 0)    ||
    (f.labels?.length ?? 0)   ||
    (f.assigneeWorkerIds?.length ?? 0) ||
    f.ownerOnly                ||
    (f.objectIds?.length ?? 0) ||
    f.dueFrom                  ||
    f.dueTo                    ||
    (f.query?.trim().length ?? 0)
  );
}
