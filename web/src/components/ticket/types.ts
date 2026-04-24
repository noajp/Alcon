// Notion-style Pages for the "Tickets" (codename) feature.
// The section is composed of a folder/file tree and a single-page
// block editor for the selected file. No per-page metadata beyond
// the tree node for now — keep it deliberately minimal.

export type TicketNodeType = 'folder' | 'file';

export interface TicketNode {
  id: string;
  type: TicketNodeType;
  name: string;
  icon?: string;
  parentId: string | null;
}

// A Ticket is a compact, immutable-ish summary extracted from a Note
// (file) at a point in time. Notes are where work happens; Tickets are
// the distilled artifacts that get referenced, shared, or picked up by
// downstream AI flows.
export interface Ticket {
  id: string;
  sourceFileId: string;
  sourceFileName: string;
  title: string;
  summary: string;                // 1-line fallback
  structured?: TicketStructured;  // Loop-style recap (optional for older tickets)
  sourceSnapshot?: string;        // BlockNote JSON of the Note body at commit time
  createdBy: string;
  createdAt: string;
}

// Structured recap (shaped by the Anthropic tool_use schema in
// supabase/functions/summarize-note). Kept optional everywhere so we
// gracefully render pre-structured tickets.
export interface TicketStructured {
  overview: string;
  summary?: string;
  decisions: { title: string; detail?: string }[];
  action_items: { title: string; owner?: string; due?: string }[];
  questions: { title: string; detail?: string }[];
  participants: { name: string; role?: string }[];
}

