'use client';

import { createContext, useContext, type ReactNode } from 'react';

// Live blocks in a description. A block is kept in the Markdown as a fenced
// code block of the language `clayware` whose body is a small JSON spec —
// ```clayware
// {"view":"gantt"}
// ```
// — so it is plain text to save, to diff and for an AI to read or write. The
// page the description belongs to supplies what the blocks can show and draws
// them (EmbedHost); the editor only places them and draws what it is given.
// Outside such a page the block shows as a quiet note.

export const EMBED_LANG = 'clayware';
/** Blocks saved under the earlier fence name are still drawn. */
export const EMBED_LANGS = [EMBED_LANG, 'alcon'] as const;

/** What a block shows: a view the host offers, and that view's settings. */
export interface EmbedSpec { view: string; [setting: string]: unknown }

export interface EmbedView {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  /** The heading it stands under in "/"; with the other inserts when omitted. */
  group?: string;
  /** Words that also find it in "/". */
  keywords?: string;
  /** What picking it places, when that is not just `{ view: id }`. */
  insert?: EmbedSpec;
}

/** A drawn block's hold on its own source. */
export interface EmbedBlock {
  /** Placed while this editor was open, rather than read from the saved text. */
  fresh: boolean;
  /** Rewrites the block's spec, and saves. */
  update: (next: EmbedSpec) => void;
  /** Takes the block out of the text, and saves. */
  remove: () => void;
}

export interface EmbedHost {
  /** The views "/" offers, in order. */
  views: EmbedView[];
  /** Draws one block. */
  render: (spec: EmbedSpec, block: EmbedBlock) => ReactNode;
  /** Whether a block reads as one line of the text: it sits as close as a
   *  paragraph does and brings its own controls. */
  line?: (spec: EmbedSpec) => boolean;
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

/** Every block a saved description holds, in the order it holds them. A fence
 *  whose body is not a spec is skipped: it draws as a note, and places nothing. */
export function embedSpecsIn(markdown: string | null | undefined): EmbedSpec[] {
  if (!markdown) return [];
  const specs: EmbedSpec[] = [];
  const fence = new RegExp('^```(?:' + EMBED_LANGS.join('|') + ')[ \\t]*\\n([\\s\\S]*?)\\n```[ \\t]*$', 'gm');
  for (const m of markdown.matchAll(fence)) {
    const spec = parseEmbed(m[1]);
    if (spec) specs.push(spec);
  }
  return specs;
}
