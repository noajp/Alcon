import { openInApp } from '@/Function/shared/appNavigation';
import { requestElementDetail } from '@/Function/shared/element/elementDetailRequest';
import { latestVersionOf, type FoundFile } from '@/hooks/attachmentData';

/** What a file is attached to, as a search result or a list row has it. */
export interface FileOwnerRef {
  element_id: string | null; object_id: string | null; strategy_id: string | null;
  folder_id?: string | null;
  /** For a file on an Element: the Object it is in. */
  element_object_id: string | null;
  /** The Domain it sits in, so the Object opens under its own Domain. */
  domain_id?: string | null;
}

/** Pure. Where a picked file result lands: the Files view with the file
 *  open, at its latest version's id (which may be newer than the version
 *  that was found). Null when the file is gone — trashed, or not visible —
 *  and the caller opens what it is attached to instead. */
export function fileResultRoute(head: { id: string } | null): { files: { fileId: string } } | null {
  return head ? { files: { fileId: head.id } } : null;
}

/** Opens a found file itself, in the Files view — a person who searched
 *  for the file wants the file; what it is attached to stays one click
 *  away in the pane's header. A file trashed or gone since it was found
 *  opens its host instead, as picking a file result did before. */
export async function openFoundFile(f: FoundFile): Promise<void> {
  const route = fileResultRoute(await latestVersionOf(f.id));
  if (route) openInApp('files', route);
  else openAttachmentOwner(f);
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
