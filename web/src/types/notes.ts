// 2-tier hierarchy: folder → file. Folders are the root-level nodes
// (scoped to the Activity Space); files always live inside a folder.
export type NoteNodeType = 'folder' | 'file';

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
