import type { CrmList } from './crmModel';

const CRM_VIEWS = ['today', 'pipeline', 'deals', 'companies', 'contacts', 'forecast', 'settings'] as const;
export type CrmViewId = typeof CRM_VIEWS[number];

/** Where the CRM App is, kept per window tab in NavigationState. */
export interface CrmRoute {
  view: CrmViewId;
  /** The pipeline shown; null = the Space's first. */
  pipelineId?: string | null;
  /** Filters shared by Pipeline and Deals. */
  stage?: string | null;
  list?: CrmList | null;
  /** A company id ('' = deals with no company). */
  account?: string | null;
  /** A Worker id: whose deals are shown. */
  owner?: string | null;
  query?: string;
  /** The record open in the side panel. */
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  /** A request (from the sidebar) to open Capture once. */
  capture?: boolean;
}

const DEFAULT_CRM_ROUTE: CrmRoute = { view: 'today' };

export function crmRoute(value: CrmRoute | undefined): CrmRoute {
  return value && (CRM_VIEWS as readonly string[]).includes(value.view) ? value : DEFAULT_CRM_ROUTE;
}

/** Changing view clears filters and panels that the destination does not show. */
export function routeTo(current: CrmRoute, patch: Partial<CrmRoute>): CrmRoute {
  const next = { ...current, ...patch };
  if (patch.view && patch.view !== current.view) {
    if (!('stage' in patch)) next.stage = null;
    if (!('list' in patch)) next.list = null;
    if (!('account' in patch)) next.account = null;
    if (!('companyId' in patch)) next.companyId = null;
    if (!('contactId' in patch)) next.contactId = null;
  }
  if (patch.pipelineId !== undefined && patch.pipelineId !== current.pipelineId) { next.stage = null; next.dealId = null; }
  return next;
}
