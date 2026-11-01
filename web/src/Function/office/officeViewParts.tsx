'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fontStack } from './officeFonts';

// What the Office views (deck, document, sheet) share: measuring the space
// they draw into, the grey canvas under an Office app's coloured bar that
// pages and slides sit on, and the CSS for a run of text.

/** The size of an element, kept current as it resizes (full screen, the
 *  pane being dragged). Zero until first measured. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** The grey canvas under an Office app's bar (PowerPoint's orange, Word's
 *  blue), with its pages in a centred column. `children` receives the
 *  canvas width, to scale the pages to. */
export function OfficeCanvas({ accent, children }: { accent: string; children: (width: number) => ReactNode }) {
  const [ref, { w }] = useElementSize<HTMLDivElement>();
  return (
    <div className="flex min-h-full flex-col bg-[var(--sheet-head)]">
      <div className="sticky top-0 z-20 h-1 shrink-0" style={{ background: accent }} />
      <div ref={ref} className="flex flex-1 flex-col items-center gap-4 py-6">{w > 0 && children(w)}</div>
    </div>
  );
}

export interface RunLook {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean;
  /** Points. */
  size?: number | null;
  color?: string | null; font?: string | null; highlight?: string | null;
  script?: 'super' | 'sub';
}

/** A run of text's look as CSS: weight, slant, lines, size (pt → px,
 *  smaller for super / subscript), colour, highlight and font stack. */
export function runCss(r: RunLook): CSSProperties {
  const px = r.size ? (r.size * 4) / 3 * (r.script ? 0.65 : 1) : undefined;
  return {
    fontWeight: r.bold ? 700 : undefined,
    fontStyle: r.italic ? 'italic' : undefined,
    textDecoration: [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    fontSize: px ? `${px}px` : undefined,
    verticalAlign: r.script === 'super' ? 'super' : r.script === 'sub' ? 'sub' : undefined,
    color: r.color ?? undefined,
    backgroundColor: r.highlight ?? undefined,
    fontFamily: fontStack(r.font) ?? undefined,
  };
}

/**
 * A paragraph's text, typed over in place (Word's and PowerPoint's
 * previews). Enter or a click elsewhere keeps it, Esc puts it back. Retyped,
 * it shows as one run in `look` (the file keeps each run's own look when
 * saved), underlined in the file's colour until it is saved.
 */
export function EditableRuns({ original, edited, onChange, look, accent, children }: {
  original: string; edited: string | undefined; onChange: (to: string) => void;
  look: CSSProperties; accent: string; children: ReactNode;
}) {
  const shown = edited ?? original;
  return (
    <span key={shown} contentEditable="plaintext-only" suppressContentEditableWarning spellCheck={false}
      onBlur={(e) => onChange(e.currentTarget.textContent ?? '')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.textContent = shown; e.currentTarget.blur(); }
      }}
      className="cursor-text rounded-[2px] outline-none focus:outline-2 focus:outline-solid"
      style={{ outlineColor: accent, ...(edited !== undefined ? { boxShadow: `inset 0 -2px 0 ${accent}` } : {}) }}>
      {edited !== undefined ? <span style={look}>{edited}</span> : children}
    </span>
  );
}
