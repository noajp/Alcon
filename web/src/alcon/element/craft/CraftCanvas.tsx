'use client';

// Figma-lite canvas. Renders a single fixed-size "page" on a dotted
// background. Tools / zoom / properties are exposed via callbacks so the
// host studio can lay them out as it sees fit (Figma puts the tool
// palette at the bottom, the design panel on the right, etc).
//
// Pointer-down on the page = drop a new item using the active tool;
// pointer-down on an item = select & drag; drag the corner handle =
// resize. Text items edit inline on double-click.

import { useEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  CraftDoc, CraftPage, CanvasItem, TextItem,
  makeText, makeRect, makeEllipse, makeImage,
} from './canvasTypes';

export type CanvasTool = 'select' | 'text' | 'rect' | 'ellipse' | 'image';

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
  onChange: (doc: CraftDoc) => void;
  tool: CanvasTool;
  onToolChange: (t: CanvasTool) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}

export const CraftCanvas = forwardRef<CraftCanvasHandle, Props>(function CraftCanvas(
  { doc, pageIndex, onChange, tool, onToolChange, selectedId, onSelect, zoom },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<null | {
    kind: 'move' | 'resize';
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  }>(null);

  const page: CraftPage = doc.pages[pageIndex] ?? doc.pages[0];

  const updatePage = useCallback(
    (mut: (p: CraftPage) => CraftPage) => {
      const nextPages = [...doc.pages];
      const idx = doc.pages.indexOf(page);
      nextPages[idx === -1 ? 0 : idx] = mut(page);
      onChange({ ...doc, pages: nextPages });
    },
    [doc, page, onChange]
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<CanvasItem>) => {
      updatePage((p) => ({
        ...p,
        items: p.items.map((it) => (it.id === id ? ({ ...it, ...patch } as CanvasItem) : it)),
      }));
    },
    [updatePage]
  );

  const deleteItem = useCallback(
    (id: string) => {
      updatePage((p) => ({ ...p, items: p.items.filter((it) => it.id !== id) }));
      if (selectedId === id) onSelect(null);
    },
    [updatePage, selectedId, onSelect]
  );

  useImperativeHandle(
    ref,
    () => ({
      setTool: (t) => onToolChange(t),
      deleteSelection: () => { if (selectedId) deleteItem(selectedId); },
    }),
    [onToolChange, selectedId, deleteItem]
  );

  const addItem = (item: CanvasItem) => {
    updatePage((p) => ({ ...p, items: [...p.items, item] }));
    onSelect(item.id);
    onToolChange('select');
  };

  const pageCoords = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pageEl = stage.querySelector('[data-page]') as HTMLElement | null;
    if (!pageEl) return { x: 0, y: 0 };
    const rect = pageEl.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };

  const handlePagePointerDown = (e: React.PointerEvent) => {
    if (tool === 'select') { onSelect(null); return; }
    const { x, y } = pageCoords(e.clientX, e.clientY);
    if (tool === 'text') addItem(makeText(x, y, doc.format));
    else if (tool === 'rect') addItem(makeRect(x - 100, y - 60));
    else if (tool === 'ellipse') addItem(makeEllipse(x - 80, y - 80));
    else if (tool === 'image') {
      const url = prompt('画像 URL (https: または data:)');
      if (url) addItem(makeImage(x - 160, y - 100, url));
    }
  };

  const handleItemPointerDown = (e: React.PointerEvent, id: string) => {
    if (tool !== 'select') return;
    e.stopPropagation();
    const it = page.items.find((i) => i.id === id);
    if (!it) return;
    onSelect(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      kind: 'move', id,
      startX: e.clientX, startY: e.clientY,
      origX: it.x, origY: it.y, origW: it.w, origH: it.h,
    };
  };

  const handleResizePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const it = page.items.find((i) => i.id === id);
    if (!it) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      kind: 'resize', id,
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
      updateItem(d.id, { x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) });
    } else {
      updateItem(d.id, {
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

  // Keyboard shortcuts. Skipped while editing a text node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.isContentEditable || t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) { e.preventDefault(); deleteItem(selectedId); }
      } else if (e.key === 'Escape') {
        onSelect(null);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'v') onToolChange('select');
        else if (e.key === 't') onToolChange('text');
        else if (e.key === 'r') onToolChange('rect');
        else if (e.key === 'o') onToolChange('ellipse');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, deleteItem, onSelect, onToolChange]);

  return (
    <div
      ref={stageRef}
      className="relative flex-1 min-h-0 overflow-auto"
      style={{
        backgroundColor: '#0e0e10',
        backgroundImage: 'radial-gradient(circle, #2a2a2e 1px, transparent 1.5px)',
        backgroundSize: '20px 20px',
        cursor: tool === 'select' ? 'default' : 'crosshair',
      }}
    >
      <div className="min-w-full min-h-full flex items-start justify-center p-16">
        <div
          data-page
          onPointerDown={handlePagePointerDown}
          style={{
            width: page.width,
            height: page.height,
            background: page.background,
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
            position: 'relative',
            overflow: 'hidden',
            marginBottom: page.height * (zoom - 1),
            borderRadius: 2,
          }}
        >
          {page.items.map((item) => (
            <RenderedItem
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onPointerDown={(e) => handleItemPointerDown(e, item.id)}
              onResizePointerDown={(e) => handleResizePointerDown(e, item.id)}
              onTextChange={(text) => updateItem(item.id, { text } as Partial<TextItem>)}
            />
          ))}
        </div>
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
        color: item.color, textAlign: item.align,
        lineHeight: 1.4,
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
