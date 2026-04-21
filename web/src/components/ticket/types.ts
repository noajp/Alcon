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
