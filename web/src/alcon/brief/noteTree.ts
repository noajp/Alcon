// Pure helpers for the OneNote-style Note tree (Cabinet > Folder > File).
// No React — shared by the sidebar (cabinet/folder), the FilesPane (file
// list), and MainContent (selection resolution) so the encoding of the
// synthetic "Unfiled" folder lives in exactly one place.

import type { NoteNode } from './types';

/** Prefix for the synthetic per-cabinet "Unfiled" folder id — represents
 *  files parked directly under a cabinet (DB allows a file row whose parent
 *  is a notebook instead of a folder). */
export const UNFILED_FOLDER_PREFIX = 'unfiled:';

export function unfiledFolderId(cabinetId: string): string {
  return `${UNFILED_FOLDER_PREFIX}${cabinetId}`;
}

export function isUnfiledFolderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(UNFILED_FOLDER_PREFIX);
}

export function cabinetIdFromUnfiled(id: string | null | undefined): string | null {
  if (!isUnfiledFolderId(id)) return null;
  return (id as string).slice(UNFILED_FOLDER_PREFIX.length);
}

/** Files belonging to a folder selection — a real folder id returns its
 *  file children; an `unfiled:<cabinetId>` marker returns the cabinet's
 *  direct file children. Alpha-sorted for a stable list. */
export function filesInFolder(nodes: NoteNode[], folderId: string | null): NoteNode[] {
  if (!folderId) return [];
  const parentId = isUnfiledFolderId(folderId) ? cabinetIdFromUnfiled(folderId) : folderId;
  return nodes
    .filter((n) => n.type === 'file' && n.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Human label for the FilesPane header. */
export function folderDisplayName(nodes: NoteNode[], folderId: string | null): string | null {
  if (!folderId) return null;
  if (isUnfiledFolderId(folderId)) return 'Unfiled';
  return nodes.find((n) => n.id === folderId)?.type === 'folder'
    ? nodes.find((n) => n.id === folderId)!.name
    : null;
}

/** Parent id to create a new file under for the current folder selection
 *  (the cabinet id for an Unfiled bucket, otherwise the folder id). Null
 *  when the selection can't host files. */
export function fileParentFor(folderId: string | null): string | null {
  if (!folderId) return null;
  return isUnfiledFolderId(folderId) ? cabinetIdFromUnfiled(folderId) : folderId;
}

/** Is `id` a folder selection that currently points at real content — a
 *  still-existing folder, or an Unfiled bucket whose cabinet still owns at
 *  least one direct file? Used to decide whether to honour the nav state. */
export function isValidFolderSelection(nodes: NoteNode[], id: string | null): boolean {
  if (!id) return false;
  if (isUnfiledFolderId(id)) {
    const cab = cabinetIdFromUnfiled(id);
    return nodes.some((n) => n.type === 'file' && n.parentId === cab);
  }
  return nodes.some((n) => n.id === id && n.type === 'folder');
}

/** The folder selection that contains a given file (real folder id, or the
 *  cabinet's Unfiled bucket when the file is parked directly under it). */
function folderOfFile(nodes: NoteNode[], fileId: string | null): string | null {
  if (!fileId) return null;
  const file = nodes.find((n) => n.id === fileId && n.type === 'file');
  if (!file?.parentId) return null;
  const parent = nodes.find((n) => n.id === file.parentId);
  if (!parent) return null;
  return parent.type === 'folder' ? parent.id : unfiledFolderId(parent.id);
}

/** Resolve the active folder for the middle pane, so it's never blank when
 *  content exists. Precedence:
 *   1. An explicit, still-valid folder selection (sidebar click).
 *   2. The folder that holds the currently-open file (deep link / the
 *      bottom "+ Create new → Note" which only sets the file id).
 *   3. The first folder (alpha), then the first cabinet's Unfiled bucket. */
export function resolveFolderSelection(
  nodes: NoteNode[],
  navFolderId: string | null,
  navFileId: string | null,
): string | null {
  if (isValidFolderSelection(nodes, navFolderId)) return navFolderId;
  const fromFile = folderOfFile(nodes, navFileId);
  if (fromFile) return fromFile;
  const firstFolder = nodes
    .filter((n) => n.type === 'folder')
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (firstFolder) return firstFolder.id;
  const cabWithFiles = nodes.find(
    (n) => n.type === 'notebook' &&
      nodes.some((f) => f.type === 'file' && f.parentId === n.id),
  );
  return cabWithFiles ? unfiledFolderId(cabWithFiles.id) : null;
}
