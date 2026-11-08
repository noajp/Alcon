'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Live blocks in a description. A block is kept in the Markdown as a fenced
// code block of the language `alcon` whose body is a small JSON spec —
// ```alcon
// {"view":"gantt"}
// ```
// — so it is plain text to save, to diff and for an AI to read or write. The
// page the description belongs to supplies what the blocks can show and draws
// them (EmbedHost); the editor only places them and draws what it is given.
// Outside such a page the block shows as a quiet note.

export const EMBED_LANG = 'alcon';

/** What a block shows: a view the host offers, and that view's settings. */
export interface EmbedSpec { view: string; [setting: string]: unknown }

export interface EmbedView {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

export interface EmbedHost {
  /** The views "/" offers, in order. */
  views: EmbedView[];
  /** Draws one block. */
  render: (spec: EmbedSpec) => ReactNode;
}

export const EmbedHostContext = createContext<EmbedHost | null>(null);
export const useEmbedHost = () => useContext(EmbedHostContext);

/** A block's spec from its source, or null when it is not one. */
export function parseEmbed(source: string): EmbedSpec | null {
  try {
    const v: unknown = JSON.parse(source.trim() || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { view?: unknown }).view === 'string' ? (v as EmbedSpec) : null;
  } catch {
    return null;
  }
}

export const embedSource = (spec: EmbedSpec) => JSON.stringify(spec);
