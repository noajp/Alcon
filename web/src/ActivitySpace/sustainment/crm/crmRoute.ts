import type { CrmList } from './crmModel';

// Where the CRM App is, kept per window tab in NavigationState.
//
// The App has the same three levels as Execution:
//   container  a pipeline (Today, Companies and Contacts sit beside the
//              pipelines in the sidebar)
//   view       a reading of the pipeline: Overview, Deals, Board, Forecast
//   record     a deal, a company or a contact, opened as a page of its own
//
// A record id set here opens that record's page over whatever view the
// pipeline was on; clearing it returns to the view.

const CRM_VIEWS = ['today', 'overview', 'deals', 'board', 'forecast', 'companies', 'contacts'] as const;
export type CrmViewId = typeof CRM_VIEWS[number];
/** The pipeline's own views — its tabs. */
export const PIPELINE_VIEWS = ['overview', 'deals', 'board', 'forecast'] as const satisfies readonly CrmViewId[];

export interface CrmRoute {
  view: CrmViewId;
  /** The pipeline shown; null = the Space's first. */
  pipelineId?: string | null;
  /** Filters on Deals and Board. */
  stage?: string | null;
  list?: CrmList | null;
  /** A company id ('' = deals with no company). */
  account?: string | null;
  /** A Worker id: whose deals are shown. */
  owner?: string | null;
  query?: string;
  /** The record open as a page. */
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  /** A request (from the sidebar) to open Capture once. */
  capture?: boolean;
  /** The pipeline settings dialog is open. */
  settings?: boolean;
}

const DEFAULT_CRM_ROUTE: CrmRoute = { view: 'today' };

export function crmRoute(value: CrmRoute | undefined): CrmRoute {
  return value && (CRM_VIEWS as readonly string[]).includes(value.view) ? value : DEFAULT_CRM_ROUTE;
}

/** Changing view clears filters and records that the destination does not show. */
export function routeTo(current: CrmRoute, patch: Partial<CrmRoute>): CrmRoute {
  const next = { ...current, ...patch };
  if (patch.view && patch.view !== current.view) {
    if (!('stage' in patch)) next.stage = null;
    if (!('list' in patch)) next.list = null;
    if (!('account' in patch)) next.account = null;
    if (!('dealId' in patch)) next.dealId = null;
    if (!('companyId' in patch)) next.companyId = null;
    if (!('contactId' in patch)) next.contactId = null;
  }
  if (patch.pipelineId !== undefined && patch.pipelineId !== current.pipelineId) { next.stage = null; next.dealId = null; }
  return next;
}
