import { openInApp } from '@/Function/shared/appNavigation';
import { crmRoute, routeTo } from '@/Function/crm/crmRoute';

/** What a file is attached to, as a search result or a list row has it. */
export interface FileOwnerRef {
  element_id: string | null; object_id: string | null; strategy_id: string | null;
  portfolio_id: string | null; deal_id: string | null; company_id: string | null;
  folder_id?: string | null;
  /** For a file on an Element: the Object it is in. */
  element_object_id: string | null;
}

/** Opens what a file is attached to, where it lives in Alcon. An Element's
 *  file opens its Object's Elements (an Element has no page of its own to
 *  go to), as ⌘K's Elements do. */
export function openAttachmentOwner(f: FileOwnerRef): void {
  if (f.element_id) openInApp('domain-elements', { objectId: f.element_object_id ?? null });
  else if (f.object_id) openInApp('objects', { objectId: f.object_id });
  else if (f.strategy_id) openInApp('strategy', { strategyId: f.strategy_id });
  else if (f.portfolio_id) openInApp('portfolio', { portfolioId: f.portfolio_id });
  else if (f.deal_id) openInApp('crm', { crm: routeTo(crmRoute(undefined), { view: 'deals', dealId: f.deal_id }) });
  else if (f.company_id) openInApp('crm', { crm: routeTo(crmRoute(undefined), { view: 'companies', companyId: f.company_id }) });
  else if (f.folder_id) openInApp('files', { files: { folderId: f.folder_id } });
}
