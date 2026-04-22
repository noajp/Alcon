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
  summary: string;
  createdBy: string;
  createdAt: string;
}

