import { openInApp } from '@/Function/shared/appNavigation';
import { requestElementDetail } from '@/Function/shared/element/elementDetailRequest';

/** What a file is attached to, as a search result or a list row has it. */
export interface FileOwnerRef {
  element_id: string | null; object_id: string | null; strategy_id: string | null;
  folder_id?: string | null;
  /** For a file on an Element: the Object it is in. */
  element_object_id: string | null;
  /** The Domain it sits in, so the Object opens under its own Domain. */
  domain_id?: string | null;
}

/** Opens what a file is attached to, where it lives in Alcon: an Element's
 *  file opens that Element's page (through its Object's). */
export function openAttachmentOwner(f: FileOwnerRef): void {
  if (f.element_id) {
    requestElementDetail(f.element_id);
    openInApp('objects', { objectId: f.element_object_id ?? null, objectDomainId: f.domain_id ?? undefined });
  }
  else if (f.object_id) openInApp('objects', { objectId: f.object_id, objectDomainId: f.domain_id ?? undefined });
  else if (f.strategy_id) openInApp('strategy', { strategyId: f.strategy_id });
  else if (f.folder_id) openInApp('files', { files: { folderId: f.folder_id } });
}
