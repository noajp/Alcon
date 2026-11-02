'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { renderMermaid } from '@/Function/shared/MermaidDiagram';
import { useI18n } from '@/Function/i18n/I18nProvider';

// Mermaid in the Note editor. A ```mermaid block stays in the editable text
// as its source (<pre data-lang="mermaid">) — that is what is saved — and its
// diagram is drawn over it, the block opened to the diagram's height and its
// source hidden. Clicking the diagram puts the caret in the source to edit
// it; leaving the block draws it again.

interface Drawn { source: string; top: number; left: number; width: number; svg?: string; error?: string }

const SELECTOR = 'pre[data-lang="mermaid"]';

export function MermaidLayer({ root, frame }: { root: RefObject<HTMLDivElement | null>; frame: RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  // The blocks in the editor, in order; state mirrors them by index.
  const pres = useRef<HTMLPreElement[]>([]);
  const heights = useRef<number[]>([]);
  const [blocks, setBlocks] = useState<Drawn[]>([]);
  const [editing, setEditing] = useState(-1);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frameId = 0;
    // Where each block is, what it says, and its diagram so far.
    const measure = () => {
      const box = frame.current?.getBoundingClientRect();
      if (!box) return;
      const found = [...el.querySelectorAll<HTMLPreElement>(SELECTOR)];
      pres.current = found;
      setBlocks((prev) => found.map((pre, i) => {
        const r = pre.getBoundingClientRect();
        const source = pre.textContent ?? '';
        const old = prev[i]?.source === source ? prev[i] : undefined;
        return { source, top: r.top - box.top, left: r.left - box.left, width: r.width, svg: old?.svg, error: old?.error };
      }));
    };
    const schedule = () => { cancelAnimationFrame(frameId); frameId = requestAnimationFrame(measure); };
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    // The block holding the caret shows its source.
    const onSelection = () => {
      const node = document.getSelection()?.anchorNode ?? null;
      const host = node && el.contains(node) ? (node instanceof Element ? node : node.parentElement)?.closest(SELECTOR) : null;
      setEditing(host ? pres.current.indexOf(host as HTMLPreElement) : -1);
    };
    document.addEventListener('selectionchange', onSelection);
    schedule();
    return () => { mo.disconnect(); ro.disconnect(); document.removeEventListener('selectionchange', onSelection); cancelAnimationFrame(frameId); };
  }, [root, frame]);

  // Draw what is new.
  useEffect(() => {
    let live = true;
    blocks.forEach((b, i) => {
      if (b.svg || b.error || !b.source.trim()) return;
      void renderMermaid(b.source).then((r) => {
        if (live) setBlocks((prev) => prev.map((x, j) => j === i && x.source === b.source ? { ...x, ...r } : x));
      });
    });
    return () => { live = false; };
  }, [blocks]);

  // Each drawn block opens to its diagram's height and hides its source;
  // the one being edited shows its source as code.
  useLayoutEffect(() => {
    pres.current.forEach((pre, i) => {
      const shown = !!blocks[i]?.svg && editing !== i;
      const h = heights.current[i];
      pre.style.color = shown ? 'transparent' : '';
      pre.style.minHeight = shown && h ? `${h}px` : '';
    });
  }, [blocks, editing]);

  const edit = (i: number) => {
    const pre = pres.current[i];
    if (!pre) return;
    const range = document.createRange();
    range.selectNodeContents(pre);
    range.collapse(false);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    root.current?.focus();
  };
  // A diagram's height, once drawn: its block opens to it.
  const sized = (i: number) => (node: HTMLDivElement | null) => {
    if (!node) return;
    const h = node.getBoundingClientRect().height;
    if (heights.current[i] === h) return;
    heights.current[i] = h;
    const pre = pres.current[i];
    if (pre && editing !== i) pre.style.minHeight = `${h}px`;
  };

  return <>
    {blocks.map((b, i) => (b.svg || b.error) && editing !== i && (
      <div key={i} role="button" tabIndex={-1} title={t('Edit the diagram')} ref={sized(i)}
        onMouseDown={(e) => { e.preventDefault(); edit(i); }}
        className="absolute z-10 flex cursor-text justify-center overflow-x-auto rounded-md bg-card px-3 py-2 [&_svg]:h-auto [&_svg]:max-w-full"
        style={{ top: b.top, left: b.left, width: b.width }}>
        {b.svg
          // Mermaid's own sanitized SVG (securityLevel: 'strict').
          ? <div className="flex w-full justify-center" dangerouslySetInnerHTML={{ __html: b.svg }} />
          : <p className="w-full text-[12px] text-[var(--status-danger)]">{t('Could not draw the diagram. Click to edit its source.')}</p>}
      </div>
    ))}
  </>;
}
