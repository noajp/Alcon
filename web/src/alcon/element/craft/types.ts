// Shared types for the Crafting feature (slide / LP / report deliverables).
//
// MVP persistence is localStorage-only, keyed by element_id. When we add a
// dedicated Supabase table later, these shapes should map 1:1.

export type CraftFormat = 'slides';

export type CraftStatus = 'draft' | 'final';

export interface CraftMessage {
  id: string;
  role: 'user' | 'assistant';
  /** For assistant turns this is the prose around the <deck-stage> block. */
  content: string;
  /** Present on assistant turns that produced an HTML draft. */
  html?: string;
  created_at: string;
}

export interface Craft {
  id: string;
  element_id: string;
  title: string;
  format: CraftFormat;
  /** Latest accepted HTML draft (from the most recent assistant turn). */
  html: string;
  status: CraftStatus;
  created_at: string;
  updated_at: string;
}

export interface CraftSession {
  element_id: string;
  /** Working title shown in the workspace header. */
  title: string;
  format: CraftFormat;
  /** Persisted multi-turn chat with the model. */
  messages: CraftMessage[];
  /** Latest HTML extracted from an assistant turn. */
  draftHtml: string | null;
  updated_at: string;
}
