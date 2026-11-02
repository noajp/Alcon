import type { CrmRoute } from '@/Function/crm/crmRoute';
import type { AuditRoute } from '@/Function/audit/auditRoute';
import type { FilesRoute } from '@/Function/files/filesRoute';

/** Where an Element opened from ⌘K goes back to: the view, its Object and
 *  the Domain that were open when it was opened. */
export interface ElementReturn {
  view: string;
  objectId: string | null;
  objectDomainId: string | null;
  domainId: string | null;
}

export interface NavigationState {
  /** The CRM App's view, filters and open deal within this window tab. */
  crm?: CrmRoute;
  /** The Audit App's view and open deployment or run within this window tab. */
  audit?: AuditRoute;
  /** The Files App's page and open file within this window tab. */
  files?: FilesRoute;
  /** The Table App's page when no Table is open: every Table in the Space,
   *  or a Domain's home, its folders (or one folder), its Tables. */
  tableBrowse?: { domainId?: string | null; view?: 'home' | 'folders' | 'tables'; folderId?: string | null };
  objectId: string | null;
  /** Domain accompanying an explicit Object route. Keeps the destination
   * Object selected while the shell changes its active Domain. */
  objectDomainId?: string | null;
  /** A Worker selected from Team; Workload keeps the filter in this tab. */
  workerId?: string | null;
  /** People: the unit in focus (its members' load and its page). */
  unitId?: string | null;
  /** An Element opened by id (⌘K) over the Domain Elements list, and where
   *  its Back returns to. */
  elementId?: string | null;
  elementReturn?: ElementReturn | null;
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
