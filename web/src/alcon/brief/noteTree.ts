// Pure helpers for the OneNote-style Note tree (Cabinet > Folder > File).
// No React — shared by the sidebar (cabinet/folder), the FilesPane (file
// list), and MainContent (selection resolution).
//
// Files always live inside a Folder. New files are routed into a folder at
// creation time (see useNotesDb.createNode), so there is no "loose file under
// a cabinet" surface in the UI.

import type { NoteNode } from './types';

/** Files belonging to a folder, alpha-sorted for a stable list. */
export function filesInFolder(nodes: NoteNode[], folderId: string | null): NoteNode[] {
  if (!folderId) return [];
  return nodes
    .filter((n) => n.type === 'file' && n.parentId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Human label for the FilesPane header (the folder's name). */
export function folderDisplayName(nodes: NoteNode[], folderId: string | null): string | null {
  if (!folderId) return null;
  const node = nodes.find((n) => n.id === folderId);
  return node?.type === 'folder' ? node.name : null;
}

/** The folder that contains a given file. */
function folderOfFile(nodes: NoteNode[], fileId: string | null): string | null {
  if (!fileId) return null;
  const file = nodes.find((n) => n.id === fileId && n.type === 'file');
  return file?.parentId ?? null;
}

/** Resolve the active folder for the middle pane, so it's never blank when
 *  content exists. Precedence:
 *   1. An explicit, still-valid folder selection (sidebar click).
 *   2. The folder that holds the currently-open file (deep link / the
 *      bottom "+ Create new → Note", which only sets the file id).
 *   3. The first folder (alpha). */
export function resolveFolderSelection(
  nodes: NoteNode[],
  navFolderId: string | null,
  navFileId: string | null,
): string | null {
  if (navFolderId && nodes.some((n) => n.id === navFolderId && n.type === 'folder')) {
    return navFolderId;
  }
  const fromFile = folderOfFile(nodes, navFileId);
  if (fromFile) return fromFile;
  const firstFolder = nodes
    .filter((n) => n.type === 'folder')
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  return firstFolder?.id ?? null;
}
