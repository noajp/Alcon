// 3-tier hierarchy (OneNote-style):
//   notebook → folder → file
// Notebooks are the only root-level nodes; folders / files always
// have a parent (a notebook directly for shallow notes, or via a
// folder for grouped ones).
export type NoteNodeType = 'notebook' | 'folder' | 'file';

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
  /** Optional Domain link — only meaningful when `type='notebook'`.
   *  Lets a Notebook scope itself to one Domain so the surrounding
   *  UI can filter / highlight accordingly. */
  linkedDomainId?: string | null;
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

export interface BriefComment {
  id: string;
  briefId: string;
  authorId: string | null;
  authorKind: 'human' | 'ai_agent';
  authorName?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
