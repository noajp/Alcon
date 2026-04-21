// Ticket domain types.
// Tickets live inside a "File" (a Notion-like page). A File is a white canvas
// on which multiple Tickets float. Each Ticket is a self-contained punch-card
// UI with title, content, and an activity log.

export type TicketColor =
  | 'neutral'
  | 'amber'
  | 'emerald'
  | 'blue'
  | 'violet'
  | 'rose';

export type ActivityKind = 'created' | 'edit' | 'comment' | 'ai_action' | 'move';

export interface TicketActivity {
  id: string;
  kind: ActivityKind;
  actor: string;
  actorKind?: 'human' | 'ai_agent';
  message: string;
  createdAt: string; // ISO
}

export interface Ticket {
  id: string;
  fileId: string;
  title: string;
  content: string;
  color: TicketColor;
  x: number;
  y: number;
  width: number;
  height: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  activity: TicketActivity[];
}

// A tree node in the tickets sidebar. 'folder' holds other nodes; 'file'
// is the target of a selection and owns a set of tickets on its canvas.
export type TicketNodeType = 'folder' | 'file';

export interface TicketNode {
  id: string;
  type: TicketNodeType;
  name: string;
  icon?: string;
  parentId: string | null;
}

// Color tokens — tinted neutrals matching designTokens.ts aesthetic.
// Each color has a "bar" (saturated left edge) and a "tint" (subtle hover).
export const TICKET_COLORS: Record<TicketColor, { bar: string; label: string }> = {
  neutral: { bar: '#A3A3A3', label: 'Neutral' },
  amber:   { bar: '#F59E0B', label: 'Amber' },
  emerald: { bar: '#10B981', label: 'Emerald' },
  blue:    { bar: '#3B82F6', label: 'Blue' },
  violet:  { bar: '#8B5CF6', label: 'Violet' },
  rose:    { bar: '#F43F5E', label: 'Rose' },
};
