import type { CrmList } from './crmModel';

const CRM_VIEWS = ['today', 'pipeline', 'deals', 'accounts', 'forecast', 'settings'] as const;
export type CrmViewId = typeof CRM_VIEWS[number];

/** Where the CRM App is, kept per window tab in NavigationState. */
export interface CrmRoute {
  view: CrmViewId;
  /** Filters shared by Pipeline and Deals. */
  stage?: string | null;
  list?: CrmList | null;
  account?: string | null;
  query?: string;
  /** The deal open in the side panel. */
  dealId?: string | null;
  /** A request (from the sidebar or a shortcut) to open Capture once. */
  capture?: boolean;
}

const DEFAULT_CRM_ROUTE: CrmRoute = { view: 'today' };

export function crmRoute(value: CrmRoute | undefined): CrmRoute {
  return value && (CRM_VIEWS as readonly string[]).includes(value.view) ? value : DEFAULT_CRM_ROUTE;
}

/** Changing view clears filters that the destination does not show. */
export function routeTo(current: CrmRoute, patch: Partial<CrmRoute>): CrmRoute {
  const next = { ...current, ...patch };
  if (patch.view && patch.view !== current.view && !('stage' in patch) && !('list' in patch) && !('account' in patch)) {
    next.stage = null; next.list = null; next.account = null;
  }
  return next;
}
