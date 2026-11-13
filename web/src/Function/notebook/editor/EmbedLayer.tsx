'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Pencil, X } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { EMBED_LANGS, parseEmbed, useEmbedHost } from './embedBlocks';
import { FILE_VIEW, FileBlock } from './fileBlocks';

// ```clayware blocks drawn live over their source, as MermaidLayer draws
// diagrams: the block (<pre data-lang="clayware">) stays in the editable text as
// its JSON spec — that is what is saved — opened to the drawing's height, its
// source hidden. The drawing is interactive; its corner offers editing the
// source and removing the block.

interface Placed { source: string; top: number; left: number; width: number }

const SELECTOR = EMBED_LANGS.map((lang) => `pre[data-lang="${lang}"]`).join(',');

export function EmbedLayer({ root, frame, editable }: { root: RefObject<HTMLDivElement | null>; frame: RefObject<HTMLDivElement | null>; editable: boolean }) {
  const { t } = useI18n();
  const host = useEmbedHost();
  const pres = useRef<HTMLPreElement[]>([]);
  const heights = useRef<number[]>([]);
  const [blocks, setBlocks] = useState<Placed[]>([]);
  const [editing, setEditing] = useState(-1);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frameId = 0;
    const measure = () => {
      const box = frame.current?.getBoundingClientRect();
      if (!box) return;
      const found = [...el.querySelectorAll<HTMLPreElement>(SELECTOR)];
      pres.current = found;
      setBlocks(found.map((pre) => {
        const r = pre.getBoundingClientRect();
        return { source: pre.textContent ?? '', top: r.top - box.top, left: r.left - box.left, width: r.width };
      }));
    };
    const schedule = () => { cancelAnimationFrame(frameId); frameId = requestAnimationFrame(measure); };
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const onSelection = () => {
      const node = document.getSelection()?.anchorNode ?? null;
      const pre = node && el.contains(node) ? (node instanceof Element ? node : node.parentElement)?.closest(SELECTOR) : null;
      setEditing(pre ? pres.current.indexOf(pre as HTMLPreElement) : -1);
    };
    document.addEventListener('selectionchange', onSelection);
    schedule();
    return () => { mo.disconnect(); ro.disconnect(); document.removeEventListener('selectionchange', onSelection); cancelAnimationFrame(frameId); };
  }, [root, frame]);

  // Each drawn block opens to its drawing's height and hides its source; the
  // one being edited shows its source.
  useLayoutEffect(() => {
    pres.current.forEach((pre, i) => {
      const shown = editing !== i;
      const h = heights.current[i];
      pre.style.color = shown ? 'transparent' : '';
      pre.style.minHeight = shown && h ? `${h}px` : '';
    });
  }, [blocks, editing]);

  const sized = (i: number) => (node: HTMLDivElement | null) => {
    if (!node) return;
    const h = node.getBoundingClientRect().height;
    if (heights.current[i] === h) return;
    heights.current[i] = h;
    const pre = pres.current[i];
    if (pre && editing !== i) pre.style.minHeight = `${h}px`;
  };

  const editSource = (i: number) => {
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
  const remove = (i: number) => {
    const pre = pres.current[i];
    if (!pre) return;
    pre.remove();
    root.current?.dispatchEvent(new Event('input', { bubbles: true }));
  };

  return <>
    {blocks.map((b, i) => {
      if (editing === i) return null;
      const spec = parseEmbed(b.source);
      return (
        <div key={i} ref={sized(i)} contentEditable={false}
          className="group/embed absolute z-10 rounded-md bg-card"
          style={{ top: b.top, left: b.left, width: b.width }}>
          {!spec ? <p className="px-3 py-2 text-[12px] text-[var(--status-danger)]">{t('This block cannot be read. Edit its source.')}</p>
            : spec.view === FILE_VIEW ? (typeof spec.id === 'string' ? <FileBlock id={spec.id} /> : null)
            : host ? host.render(spec)
            : <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('This block shows on its own page.')}</p>}
          {editable && (
            <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/embed:opacity-100">
              <button type="button" title={t('Edit the source')} aria-label={t('Edit the source')}
                onMouseDown={(e) => { e.preventDefault(); editSource(i); }}
                className="flex size-6 items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil size={13} /></button>
              <button type="button" title={t('Remove the block')} aria-label={t('Remove the block')}
                onMouseDown={(e) => { e.preventDefault(); remove(i); }}
                className="flex size-6 items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-muted hover:text-foreground"><X size={13} /></button>
            </div>
          )}
        </div>
      );
    })}
  </>;
}
