// 3-tier hierarchy: folder → section → file. Folders are the root-level
// nodes (scoped to the Activity Space); sections are OneNote-style tabs
// inside a folder; files hold the content. Files may also sit directly
// under a folder — that's the default before any section is created.
export type NoteNodeType = 'folder' | 'section' | 'file';

export interface NoteNode {
  id: string;
  type: NoteNodeType;
  name: string;
  icon?: string;
  parentId: string | null;
  /** Optional Object link. When set on a file/folder, bullet →
   *  Element conversion pre-selects the linked Object (and its
   *  Domain) instead of falling back to the Individual Domain. */
  linkedObjectId?: string | null;
  /** auth user id of the creator — the Profile page lists a person's own notes. */
  createdBy?: string;
  /** Last change, ISO — the Note list's Recent orders by it. */
  updatedAt?: string;
}

export interface Brief {
  id: string;
  sourceFileId: string;
  sourceFileName: string;
  title: string;
  summary: string;
  structured?: BriefStructured;
  sourceSnapshot?: string;
  createdBy: string;
  createdAt: string;
}

export interface BriefStructured {
  overview: string;
  summary?: string;
  decisions: { title: string; detail?: string }[];
  action_items: { title: string; owner?: string; due?: string }[];
  questions: { title: string; detail?: string }[];
  participants: { name: string; role?: string }[];
}

