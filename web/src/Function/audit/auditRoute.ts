// Where the Audit App is, kept per window tab in NavigationState.
//
//   overview   what needs a person, how much is handed to AI, the workflows
//   workflow   one deployment, through its tabs (overview, runs, flow,
//              record integrity)
//   log        every run, newest first; `attention` narrows it to the runs
//              that ask something of a person
// A run id opens the run's steps beside the log or the workflow's runs.

const AUDIT_VIEWS = ['overview', 'workflow', 'log'] as const;
export type AuditViewId = typeof AUDIT_VIEWS[number];

export type WorkflowTab = 'overview' | 'runs' | 'flow' | 'integrity';

export interface AuditRoute {
  view: AuditViewId;
  deploymentId?: string | null;
  tab?: WorkflowTab;
  runId?: string | null;
  attention?: boolean;
}

const DEFAULT_AUDIT_ROUTE: AuditRoute = { view: 'overview' };

export function auditRoute(value: AuditRoute | undefined): AuditRoute {
  if (!value || !(AUDIT_VIEWS as readonly string[]).includes(value.view)) return DEFAULT_AUDIT_ROUTE;
  if (value.view === 'workflow' && !value.deploymentId) return DEFAULT_AUDIT_ROUTE;
  return value;
}
