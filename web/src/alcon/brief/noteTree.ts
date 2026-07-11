// Pure helpers for the 3-tier Note tree (Folder > Section > File). No React —
// shared by the Folder sidebar, the SectionTabs strip, the FilesPane (file
// list), and MainContent (selection resolution).
//
// Sections are OneNote-style tabs inside a folder. Files usually live inside
// a section, but may also sit directly under a folder — pre-section data and
// the "no sections yet" default both render that way.

import type { NoteNode } from './types';

/** Sections belonging to a folder, alpha-sorted for a stable tab order. */
export function sectionsInFolder(nodes: NoteNode[], folderId: string | null): NoteNode[] {
  if (!folderId) return [];
  return nodes
    .filter((n) => n.type === 'section' && n.parentId === folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Files directly under a parent (a section, or a folder for the
 *  sectionless default), alpha-sorted for a stable list. */
export function filesInFolder(nodes: NoteNode[], parentId: string | null): NoteNode[] {
  if (!parentId) return [];
  return nodes
    .filter((n) => n.type === 'file' && n.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve the active section for a folder. An explicit, still-valid pick
 *  wins; otherwise the first tab. `null` = the folder's direct files (only
 *  meaningful while the folder has no sections). */
export function resolveSectionSelection(
  nodes: NoteNode[],
  folderId: string | null,
  pickedSectionId: string | null,
): string | null {
  const sections = sectionsInFolder(nodes, folderId);
  if (sections.length === 0) return null;
  if (pickedSectionId && sections.some((s) => s.id === pickedSectionId)) return pickedSectionId;
  return sections[0].id;
}

/** Human label for the FilesPane header (the folder's name). */
export function folderDisplayName(nodes: NoteNode[], folderId: string | null): string | null {
  if (!folderId) return null;
  const node = nodes.find((n) => n.id === folderId);
  return node?.type === 'folder' ? node.name : null;
}

/** The folder that contains a given file — climbs through its section (when
 *  the file lives in one) up to the root folder. */
function folderOfFile(nodes: NoteNode[], fileId: string | null): string | null {
  if (!fileId) return null;
  const file = nodes.find((n) => n.id === fileId && n.type === 'file');
  let parentId = file?.parentId ?? null;
  while (parentId) {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return null;
    if (parent.type === 'folder') return parent.id;
    parentId = parent.parentId;
  }
  return null;
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
