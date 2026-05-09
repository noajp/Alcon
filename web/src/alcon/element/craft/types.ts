// Shared types for the Crafting feature.
//
// Two output formats: documentation (long-form, A4) and presentation
// (16:9 slide). Each gets its own visual identity (navy band vs dark
// orange band) and its own default page size on the canvas.
//
// Persistence is localStorage-only for now, keyed by element_id. The
// shape mirrors what a future Supabase table would hold, so the swap is
// mechanical.
//
// `canvas` is the editable source of truth (Figma-lite layout). `html`
// is its rendered form, kept on the record so consumers (preview modal,
// downloads, the existing attachments shim) can use it directly.

import type { CraftDoc } from './canvasTypes';

export type CraftFormat = 'documentation' | 'presentation';

export type CraftStatus = 'draft' | 'final';

export interface CraftMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  html?: string;
  created_at: string;
}

export interface Craft {
  id: string;
  element_id: string;
  title: string;
  format: CraftFormat;
  /** Rendered HTML (from canvas) — used for preview / download / printing. */
  html: string;
  /** Editable canvas representation; absent on legacy crafts. */
  canvas?: CraftDoc;
  status: CraftStatus;
  created_at: string;
  updated_at: string;
}

export interface CraftSession {
  element_id: string;
  title: string;
  format: CraftFormat;
  /** AI chat history (kept for the optional AI assist sidebar). */
  messages: CraftMessage[];
  /** Editable canvas state — primary source of truth for the studio. */
  canvas: CraftDoc;
  /** Last rendered HTML (mirror of `canvas`). */
  draftHtml: string | null;
  updated_at: string;
}
