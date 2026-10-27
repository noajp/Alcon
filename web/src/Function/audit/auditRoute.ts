// Where the Audit App is, kept per window tab in NavigationState.
//
//   workflows   the ledger: every deployment, where it runs and how it goes
//   log         every run, newest first; `attention` narrows it to the runs
//               that ask something of a person
// A deployment id opens that deployment's page; a run id opens the run's
// steps beside the log.

const AUDIT_VIEWS = ['workflows', 'log'] as const;
export type AuditViewId = typeof AUDIT_VIEWS[number];

export interface AuditRoute {
  view: AuditViewId;
  deploymentId?: string | null;
  runId?: string | null;
  attention?: boolean;
}

const DEFAULT_AUDIT_ROUTE: AuditRoute = { view: 'workflows' };

export function auditRoute(value: AuditRoute | undefined): AuditRoute {
  return value && (AUDIT_VIEWS as readonly string[]).includes(value.view) ? value : DEFAULT_AUDIT_ROUTE;
}
