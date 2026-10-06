import type { CrmList } from './crmModel';

// Where the CRM App is, kept per window tab in NavigationState.
//
// The CRM is read through a scope (everything, the Space's records, or one
// Domain's — see Function/shared/tool/toolScope), and inside it:
//   home       the scope's overview: its pipelines and how they stand
//   today      my queue across the scope's pipelines
//   deals      every deal in the scope (a list, or one pipeline's board)
//   forecast   what each pipeline in the scope is expected to bring in
//   companies, contacts   the records, as ledgers
// A deal, company or contact id opens that record's page over the view.

const CRM_VIEWS = ['home', 'today', 'deals', 'board', 'forecast', 'companies', 'contacts'] as const;
export type CrmViewId = typeof CRM_VIEWS[number];

export interface CrmRoute {
  view: CrmViewId;
  /** The pipeline a board shows and new deals go into; null = the scope's first. */
  pipelineId?: string | null;
  /** Filters on the deals. */
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
  /** A request to open Capture once. */
  capture?: boolean;
  /** The pipeline settings dialog is open. */
  settings?: boolean;
}

const DEFAULT_CRM_ROUTE: CrmRoute = { view: 'home' };

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
    if (!('owner' in patch)) next.owner = null;
    if (!('dealId' in patch)) next.dealId = null;
    if (!('companyId' in patch)) next.companyId = null;
    if (!('contactId' in patch)) next.contactId = null;
  }
  if (patch.pipelineId !== undefined && patch.pipelineId !== current.pipelineId) { next.stage = null; next.dealId = null; }
  return next;
}
