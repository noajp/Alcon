// Shared types for the Crafting feature.
//
// Two output formats: documentation (long-form, Notion-like) and
// presentation (slide deck, 16:9 stage). Each gets its own system prompt
// in the edge function and its own visual identity in the UI (navy band
// vs dark orange band).
//
// MVP persistence is localStorage-only, keyed by element_id. When we add
// a dedicated Supabase table later, these shapes should map 1:1.

export type CraftFormat = 'documentation' | 'presentation';

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
  /** Latest accepted HTML draft (from the most recent assistant turn or manual edit). */
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
  /** Latest HTML extracted from an assistant turn or manually edited by the user. */
  draftHtml: string | null;
  updated_at: string;
}
