import type { ScmView } from '@/ActivitySpace/sustainment/scm/scmNavigation';
import type { ScmHealth } from '@/ActivitySpace/sustainment/scm/scmEngine';
import type { CrmRoute } from '@/ActivitySpace/sustainment/crm/crmRoute';

export interface NavigationState {
  /** SCM: the open pane, the location every pane is filtered to (null = all),
   * the item-location open in detail (`itemId:locationId`), and the open
   * purchase order. */
  scmView?: ScmView;
  /** SCM scope: null = everything visible, 'space' = records shared by the
   * Space, otherwise the Domain whose supply the panes show. */
  scmScope?: string | null;
  scmLocationId?: string | null;
  scmNode?: string | null;
  scmOrderId?: string | null;
  /** Inventory filtered to one stock health, when opened from a health count. */
  scmHealth?: ScmHealth | null;
  /** Scenarios opened from a supplier, pre-set to simulate its delay. */
  scmSupplierDelay?: string | null;
  /** The stock ledger filtered to one item. */
  scmLedgerItemId?: string | null;
  /** Inventory showing the item catalogue rather than stock. */
  scmCatalog?: boolean | null;
  /** The CRM App's view, filters and open deal within this window tab. */
  crm?: CrmRoute;
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
  documentId?: string | null;
  canvasId?: string | null;
}
