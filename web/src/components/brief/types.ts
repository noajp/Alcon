// Notion-style Pages for the "Tickets" (codename) feature.
// The section is composed of a folder/file tree and a single-page
// block editor for the selected file. No per-page metadata beyond
// the tree node for now — keep it deliberately minimal.

export type NoteNodeType = 'folder' | 'file';

export interface NoteNode {
  id: string;
  type: NoteNodeType;
  name: string;
  icon?: string;
  parentId: string | null;
}

// A Brief is a compact, immutable-ish summary extracted from a Note
// (file) at a point in time. Notes are where work happens; Tickets are
// the distilled artifacts that get referenced, shared, or picked up by
// downstream AI flows.
export interface Brief {
  id: string;
  sourceFileId: string;
  sourceFileName: string;
  title: string;
  summary: string;                // 1-line fallback
  structured?: BriefStructured;  // Loop-style recap (optional for older briefs)
  sourceSnapshot?: string;        // BlockNote JSON of the Note body at commit time
  createdBy: string;
  createdAt: string;
}

// Structured recap (shaped by the Anthropic tool_use schema in
// supabase/functions/summarize-note). Kept optional everywhere so we
// gracefully render pre-structured briefs.
export interface BriefStructured {
  overview: string;
  summary?: string;
  decisions: { title: string; detail?: string }[];
  action_items: { title: string; owner?: string; due?: string }[];
  questions: { title: string; detail?: string }[];
  participants: { name: string; role?: string }[];
}

// A lightweight comment anchored to a Brief.
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

