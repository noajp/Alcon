import type { CrmRoute } from '@/Function/crm/crmRoute';
import type { AuditRoute } from '@/Function/audit/auditRoute';

export interface NavigationState {
  /** The CRM App's view, filters and open deal within this window tab. */
  crm?: CrmRoute;
  /** The Audit App's view and open deployment or run within this window tab. */
  audit?: AuditRoute;
  objectId: string | null;
  /** Domain accompanying an explicit Object route. Keeps the destination
   * Object selected while the shell changes its active Domain. */
  objectDomainId?: string | null;
  /** A Worker selected from Team; Workload keeps the filter in this tab. */
  workerId?: string | null;
  noteId?: string | null;
  /** Note Folder currently focused in the middle pane (a root folder id). */
  noteFolderId?: string | null;
  /** Section picked in the sidebar's notebook tree. null = derived from the
   *  open page, else the Folder's first Section. */
  noteSectionId?: string | null;
  /** Table currently open in the Table surface (a `tables` row id). The list
   *  lives in the sidebar; this is which one the main pane shows. */
  tableId?: string | null;
  /** Strategy currently open in the Strategy surface (a `strategies` row
   *  id). null = the portfolio root list. Lets other surfaces (e.g. an
   *  Object's Properties rail) deep-link straight into a Strategy. */
  strategyId?: string | null;
  /** The sidebar's "+" in Strategy mode asked for a new Initiative. The
   *  portfolio root opens its create dialog and clears this. Carried in
   *  navigation so the request lands in this tab's surface once it is
   *  mounted, not in whichever listener happened to exist. */
  strategyCreate?: boolean | null;
  /** The sidebar's "+" on the Portfolio page asked for a new Portfolio. */
  portfolioCreate?: boolean | null;
  /** Portfolio open on the Portfolio page; null = the tree. */
  portfolioId?: string | null;
  /** The Vision the Strategy pages show (its Portfolios, its Initiatives);
   *  null = the Space's first Vision. */
  visionId?: string | null;
  /** The sidebar's "+" asked for a new Vision. */
  visionCreate?: boolean | null;
  /** What the Home main island is showing, when on the Home view. A pinned
   *  item's content renders in place (no layer/view switch) instead of the
   *  welcome. null = the welcome landing. */
  homeSelection?: { type: 'note_folder' | 'domain'; id: string } | null;
  /** The pull request open in the Reviews mode; null = the overview. */
  codeChangeId?: string | null;
  documentId?: string | null;
  canvasId?: string | null;
}
