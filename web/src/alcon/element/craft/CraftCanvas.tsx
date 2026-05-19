'use client';

// Figma-lite canvas. All pages are rendered as a vertical stack — the
// active page is the one closest to the viewport center (tracked via
// IntersectionObserver). On mount we auto-fit zoom so the first page
// fills the viewport height, so a single slide doesn't leave the bottom
// half of the studio empty.
//
// Tools / zoom / properties are exposed via callbacks so the host studio
// can lay them out as it sees fit (Figma puts the tool palette at the
// bottom, the design panel on the right, etc).
//
// Pointer-down on a page = drop a new item using the active tool;
// pointer-down on an item = select & drag; drag the corner handle =
// resize. Text items edit inline on double-click. Selected items can be
// nudged with arrow keys (1px) or shift+arrow (10px), duplicated with
// ⌘/Ctrl+D, deleted with Del/Backspace.

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import {
  CraftDoc, CraftPage, CanvasItem, TextItem,
  makeText, makeRect, makeEllipse, makeImage,
} from './canvasTypes';

export type CanvasTool = 'select' | 'text' | 'rect' | 'ellipse' | 'image';

// Pixel offsets for the floating islands the studio overlays on top of
// this canvas. The dotted bg is full-bleed; the *content* slot is padded
// only for breathing room now that side inspectors are hidden.
const LEFT_RESERVE = 32;
const RIGHT_RESERVE = 32;

export interface CraftCanvasHandle {
  /** Imperatively swap the active tool from the parent toolbar. */
  setTool: (t: CanvasTool) => void;
  /** Imperatively delete the current selection. */
  deleteSelection: () => void;
}

interface Props {
  doc: CraftDoc;
  /** Which page in `doc.pages` is currently being edited. */
  pageIndex: number;
  /** Bubbled up when the user scrolls to a different page so the
      inspector / studio chrome can stay in sync. */
  onPageIndexChange: (idx: number) => void;
  onChange: (doc: CraftDoc) => void;
  tool: CanvasTool;
  onToolChange: (t: CanvasTool) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}

export const CraftCanvas = forwardRef<CraftCanvasHandle, Props>(function CraftCanvas(
  { doc, pageIndex, onPageIndexChange, onChange, tool, onToolChange, selectedId, onSelect, zoom, onZoomChange },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const draggingRef = useRef<null | {
    kind: 'move' | 'resize';
    id: string;
    pageIdx: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  }>(null);
  // Have we run the auto-fit yet? Only happens once per mount so users
  // can freely zoom without us yanking their viewport back.
  const [autoFitDone, setAutoFitDone] = useState(false);

  const updatePageAt = useCallback(
    (idx: number, mut: (p: CraftPage) => CraftPage) => {
      const nextPages = [...doc.pages];
      if (!nextPages[idx]) return;
      nextPages[idx] = mut(nextPages[idx]);
      onChange({ ...doc, pages: nextPages });
    },
    [doc, onChange]
  );

  const updateItem = useCallback(
    (idx: number, id: string, patch: Partial<CanvasItem>) => {
      updatePageAt(idx, (p) => ({
        ...p,
        items: p.items.map((it) => (it.id === id ? ({ ...it, ...patch } as CanvasItem) : it)),
      }));
    },
    [updatePageAt]
  );

  const deleteItem = useCallback(
    (idx: number, id: string) => {
      updatePageAt(idx, (p) => ({ ...p, items: p.items.filter((it) => it.id !== id) }));
      if (selectedId === id) onSelect(null);
    },
    [updatePageAt, selectedId, onSelect]
  );

  useImperativeHandle(
    ref,
    () => ({
      setTool: (t) => onToolChange(t),
      deleteSelection: () => {
        if (!selectedId) return;
        // Find which page hosts the selection.
        for (let i = 0; i < doc.pages.length; i++) {
          if (doc.pages[i].items.some((it) => it.id === selectedId)) {
            deleteItem(i, selectedId);
            return;
          }
        }
      },
    }),
    [onToolChange, selectedId, deleteItem, doc.pages]
  );

  const addItemTo = (idx: number, item: CanvasItem) => {
    updatePageAt(idx, (p) => ({ ...p, items: [...p.items, item] }));
    onSelect(item.id);
    onToolChange('select');
  };

  const pageCoords = (clientX: number, clientY: number, idx: number) => {
    const pageEl = pageRefs.current.get(idx);
    if (!pageEl) return { x: 0, y: 0 };
    const rect = pageEl.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };

  const handlePagePointerDown = (e: React.PointerEvent, idx: number) => {
    if (tool === 'select') { onSelect(null); return; }
    const { x, y } = pageCoords(e.clientX, e.clientY, idx);
    if (tool === 'text') addItemTo(idx, makeText(x, y, doc.format));
    else if (tool === 'rect') addItemTo(idx, makeRect(x - 100, y - 60));
    else if (tool === 'ellipse') addItemTo(idx, makeEllipse(x - 80, y - 80));
    else if (tool === 'image') {
      const url = prompt('画像 URL (https: または data:)');
      if (url) addItemTo(idx, makeImage(x - 160, y - 100, url));
    }
  };

  const handleItemPointerDown = (e: React.PointerEvent, idx: number, id: string) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const it = doc.pages[idx]?.items.find((i) => i.id === id);
    if (!it) return;
    onSelect(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      kind: 'move', id, pageIdx: idx,
      startX: e.clientX, startY: e.clientY,
      origX: it.x, origY: it.y, origW: it.w, origH: it.h,
    };
  };

  const handleResizePointerDown = (e: React.PointerEvent, idx: number, id: string) => {
    e.stopPropagation();
    const it = doc.pages[idx]?.items.find((i) => i.id === id);
    if (!it) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      kind: 'resize', id, pageIdx: idx,
      startX: e.clientX, startY: e.clientY,
      origX: it.x, origY: it.y, origW: it.w, origH: it.h,
    };
  };

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (d.kind === 'move') {
      updateItem(d.pageIdx, d.id, { x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) });
    } else {
      updateItem(d.pageIdx, d.id, {
        w: Math.max(20, Math.round(d.origW + dx)),
        h: Math.max(20, Math.round(d.origH + dy)),
      });
    }
  }, [updateItem, zoom]);

  const handlePointerUp = useCallback(() => { draggingRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // Locate the (page, item) pair for the current selection so keyboard
  // shortcuts can act on it without a separate selection-context state.
  const findSelected = useCallback((): { idx: number; item: CanvasItem } | null => {
    if (!selectedId) return null;
    for (let i = 0; i < doc.pages.length; i++) {
      const it = doc.pages[i].items.find((x) => x.id === selectedId);
      if (it) return { idx: i, item: it };
    }
    return null;
  }, [doc.pages, selectedId]);

  // Keyboard shortcuts. Skipped while editing a text node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.isContentEditable || t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;

      const sel = findSelected();
      const step = e.shiftKey ? 10 : 1;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel) { e.preventDefault(); deleteItem(sel.idx, sel.item.id); }
      } else if (e.key === 'Escape') {
        onSelect(null);
      } else if (e.key === 'ArrowLeft' && sel) {
        e.preventDefault();
        updateItem(sel.idx, sel.item.id, { x: sel.item.x - step });
      } else if (e.key === 'ArrowRight' && sel) {
        e.preventDefault();
        updateItem(sel.idx, sel.item.id, { x: sel.item.x + step });
      } else if (e.key === 'ArrowUp' && sel) {
        e.preventDefault();
        updateItem(sel.idx, sel.item.id, { y: sel.item.y - step });
      } else if (e.key === 'ArrowDown' && sel) {
        e.preventDefault();
        updateItem(sel.idx, sel.item.id, { y: sel.item.y + step });
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && sel) {
        e.preventDefault();
        const dup: CanvasItem = {
          ...sel.item,
          id: `${sel.item.type[0]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          x: sel.item.x + 16,
          y: sel.item.y + 16,
        } as CanvasItem;
        updatePageAt(sel.idx, (p) => ({ ...p, items: [...p.items, dup] }));
        onSelect(dup.id);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'v') onToolChange('select');
        else if (e.key === 't') onToolChange('text');
        else if (e.key === 'r') onToolChange('rect');
        else if (e.key === 'o') onToolChange('ellipse');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [findSelected, deleteItem, updateItem, updatePageAt, onSelect, onToolChange]);

  // Auto-fit: on first render compute a zoom that fits the first page
  // into the available area between the floating islands. The canvas
  // background is full-bleed, but the islands overlap its left/right
  // edges; we offset the content so pages center in the visible slot.
  // Capped at 1.0 so a tall viewport doesn't blow slides up beyond
  // their native size. Runs once per mount.
  useEffect(() => {
    if (autoFitDone) return;
    const stage = stageRef.current;
    const first = doc.pages[0];
    if (!stage || !first) return;
    const innerW = Math.max(200, stage.clientWidth - LEFT_RESERVE - RIGHT_RESERVE - 32);
    const innerH = Math.max(200, stage.clientHeight - 156);
    const fitZoom = Math.min(1, innerH / first.height, innerW / first.width);
    onZoomChange(Number(Math.max(0.2, fitZoom).toFixed(2)));
    setAutoFitDone(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFitDone, doc.pages.length]);

  // Scroll-aware pageIndex — the page closest to the viewport center
  // becomes the "active" one (drives the inspector).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Prefer the entry with the highest intersection ratio; that's
        // visually the most-foregrounded page.
        let bestIdx = -1;
        let bestRatio = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.pageIndex);
          if (Number.isFinite(idx) && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestIdx = idx;
          }
        }
        if (bestIdx !== -1 && bestIdx !== pageIndex) {
          onPageIndexChange(bestIdx);
        }
      },
      { root: stage, threshold: [0.4, 0.6, 0.8] }
    );
    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [doc.pages.length, onPageIndexChange, pageIndex]);

  return (
    <div
      ref={stageRef}
      data-craft-canvas-stage
      className={
        // Full-bleed dotted canvas. h-full + w-full are needed because
        // the parent (`absolute inset-0`) isn't a flex container, so
        // `flex-1` would leave the element collapsed to its content.
        'relative w-full h-full overflow-auto bg-[#f4f4f5] dark:bg-[#0e0e10] ' +
        '[background-image:radial-gradient(circle,#d4d4d8_1px,transparent_1.5px)] ' +
        'dark:[background-image:radial-gradient(circle,#2a2a2e_1px,transparent_1.5px)] ' +
        '[background-size:20px_20px]'
      }
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
    >
      {/* Inner content slot — padding reserves room for the right inspector
          and top toolbar so pages center in the visible working area. */}
      <div
        className="flex flex-col items-center gap-10"
        style={{
          minHeight: '100%',
          paddingLeft: LEFT_RESERVE,
          paddingRight: RIGHT_RESERVE,
          paddingTop: 120,
          paddingBottom: 32,
          // 1 page → vertical centering (no empty slot below the slide).
          // 2+ pages → top-aligned so multi-page scrolling feels natural.
          justifyContent: doc.pages.length === 1 ? 'center' : 'flex-start',
        }}
      >
        {doc.pages.map((p, idx) => (
          <div
            key={p.id}
            data-page-index={idx}
            ref={(el) => {
              if (el) pageRefs.current.set(idx, el);
              else pageRefs.current.delete(idx);
            }}
            onPointerDown={(e) => handlePagePointerDown(e, idx)}
            style={{
              width: p.width * zoom,
              height: p.height * zoom,
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: p.width,
                height: p.height,
                background: p.background,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
                position: 'absolute',
                top: 0,
                left: 0,
                overflow: 'hidden',
                borderRadius: 2,
              }}
            >
              {p.items.map((item) => (
                <RenderedItem
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onPointerDown={(e) => handleItemPointerDown(e, idx, item.id)}
                  onResizePointerDown={(e) => handleResizePointerDown(e, idx, item.id)}
                  onTextChange={(text) => updateItem(idx, item.id, { text } as Partial<TextItem>)}
                />
              ))}
            </div>
            {/* Page number badge — Figma shows page n/m on the corner */}
            <span className="absolute -top-7 left-0 text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
              {idx + 1} / {doc.pages.length}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

function RenderedItem({
  item, selected, onPointerDown, onResizePointerDown, onTextChange,
}: {
  item: CanvasItem;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onTextChange: (text: string) => void;
}) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: item.x, top: item.y, width: item.w, height: item.h,
    boxSizing: 'border-box',
    cursor: 'move',
    outline: selected ? '2px solid #F24E1E' : 'none', // Figma's brand red-orange
    outlineOffset: 1,
  };
  let body: React.ReactNode = null;
  switch (item.type) {
    case 'text':
      body = <EditableText item={item} onChange={onTextChange} />;
      break;
    case 'rect':
      body = (
        <div style={{
          width: '100%', height: '100%',
          background: item.fill,
          border: `${item.strokeWidth}px solid ${item.stroke}`,
          borderRadius: item.radius,
        }} />
      );
      break;
    case 'ellipse':
      body = (
        <div style={{
          width: '100%', height: '100%',
          background: item.fill,
          border: `${item.strokeWidth}px solid ${item.stroke}`,
          borderRadius: 9999,
        }} />
      );
      break;
    case 'image':
      body = (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.src} alt="" style={{ width: '100%', height: '100%', objectFit: item.fit, pointerEvents: 'none' }} />
      );
      break;
  }
  return (
    <div onPointerDown={onPointerDown} style={baseStyle}>
      {body}
      {selected && (
        <span
          onPointerDown={onResizePointerDown}
          style={{
            position: 'absolute', right: -6, bottom: -6,
            width: 12, height: 12, background: '#F24E1E', borderRadius: 2,
            cursor: 'nwse-resize',
          }}
        />
      )}
    </div>
  );
}

function EditableText({
  item, onChange,
}: { item: TextItem; onChange: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);
  useEffect(() => {
    if (ref.current && !editingRef.current) ref.current.innerText = item.text;
  }, [item.text]);
  return (
    <div
      ref={ref}
      onDoubleClick={(e) => {
        e.stopPropagation();
        editingRef.current = true;
        const el = ref.current;
        if (el) {
          el.contentEditable = 'true';
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        }
      }}
      onBlur={() => {
        editingRef.current = false;
        if (ref.current) {
          ref.current.contentEditable = 'false';
          onChange(ref.current.innerText);
        }
      }}
      onPointerDown={(e) => { if (editingRef.current) e.stopPropagation(); }}
      suppressContentEditableWarning
      style={{
        width: '100%', height: '100%',
        fontSize: item.fontSize, fontWeight: item.fontWeight,
        fontStyle: item.fontStyle ?? 'normal',
        textDecoration: item.textDecoration ?? 'none',
        background: item.backgroundColor ?? 'transparent',
        color: item.color, textAlign: item.align,
        lineHeight: item.lineHeight ?? 1.4,
        fontFamily: item.fontFamily ?? 'inherit',
        cursor: editingRef.current ? 'text' : 'move',
        outline: 'none',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {item.text}
    </div>
  );
}
