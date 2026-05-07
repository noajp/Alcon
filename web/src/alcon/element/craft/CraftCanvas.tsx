'use client';

// Figma-lite canvas editor.
//
// Renders a fixed-size "page" on a dotted infinite background. Items are
// absolute-positioned divs (text / rect / ellipse / image). Pointer-down
// on the page = drop a new item using the active tool; pointer-down on
// an item = select & drag; drag the corner handle = resize. Text items
// edit inline on double-click.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  MousePointer2, Type as TypeIcon, Square as SquareIcon, Circle as CircleIcon,
  Image as ImageIconLuc, Trash2, Bold,
} from 'lucide-react';
import {
  CraftDoc, CraftPage, CanvasItem, TextItem, RectItem, EllipseItem, ImageItem,
  makeText, makeRect, makeEllipse, makeImage,
} from './canvasTypes';

type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'image';

interface Props {
  doc: CraftDoc;
  onChange: (doc: CraftDoc) => void;
  /** Used to decide default text size etc. */
}

const SWATCHES = ['#111111', '#1B4FA7', '#0F2A52', '#B7410E', '#E2722C', '#3D7A4A', '#A3221C', '#D49A1A', '#6B7280', '#ffffff'];
const FONT_PRESETS: { label: string; size: number }[] = [
  { label: 'S', size: 14 },
  { label: 'M', size: 20 },
  { label: 'L', size: 32 },
  { label: 'XL', size: 56 },
];

export function CraftCanvas({ doc, onChange }: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.7);
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

  // Single page only for v1. Multi-page (slide deck) is a follow-up.
  const page: CraftPage = doc.pages[0];

  const updatePage = useCallback(
    (mut: (p: CraftPage) => CraftPage) => {
      const nextPages = [...doc.pages];
      nextPages[0] = mut(page);
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
      setSelectedId((s) => (s === id ? null : s));
    },
    [updatePage]
  );

  const addItem = (item: CanvasItem) => {
    updatePage((p) => ({ ...p, items: [...p.items, item] }));
    setSelectedId(item.id);
    setTool('select');
  };

  // Map a window/page coordinate into page-local px (accounting for zoom).
  const pageCoords = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pageEl = stage.querySelector('[data-page]') as HTMLElement | null;
    if (!pageEl) return { x: 0, y: 0 };
    const rect = pageEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  };

  const handlePagePointerDown = (e: React.PointerEvent) => {
    if (tool === 'select') {
      setSelectedId(null);
      return;
    }
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
    setSelectedId(id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      kind: 'move',
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: it.x,
      origY: it.y,
      origW: it.w,
      origH: it.h,
    };
  };

  const handleResizePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const it = page.items.find((i) => i.id === id);
    if (!it) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      kind: 'resize',
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: it.x,
      origY: it.y,
      origW: it.w,
      origH: it.h,
    };
  };

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
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
    },
    [updateItem, zoom]
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // Keyboard: Delete clears selection, Esc deselects, T/R/E/I shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && !(e.target as HTMLElement).matches?.('input,textarea')) {
          e.preventDefault();
          deleteItem(selectedId);
        }
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'v') setTool('select');
        else if (e.key === 't') setTool('text');
        else if (e.key === 'r') setTool('rect');
        else if (e.key === 'o') setTool('ellipse');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, deleteItem]);

  const selectedItem = page.items.find((it) => it.id === selectedId) || null;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {/* Floating tool palette — top center */}
      <div className="absolute left-1/2 -translate-x-1/2 top-3 z-10 flex items-center gap-0.5 px-1.5 py-1 bg-white rounded-lg shadow-md border border-zinc-200">
        <Palette tool={tool} setTool={setTool} />
      </div>

      {/* Zoom + page size — bottom right */}
      <div className="absolute right-3 bottom-3 z-10 flex items-center gap-1 px-2 py-1 bg-white rounded-md shadow-sm border border-zinc-200 text-[11px] text-zinc-600">
        <button onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))} className="px-1.5 hover:bg-zinc-100 rounded">−</button>
        <span className="tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="px-1.5 hover:bg-zinc-100 rounded">+</button>
        <span className="ml-2 text-zinc-400">·</span>
        <span className="ml-1">{page.width} × {page.height}</span>
      </div>

      {/* Properties strip — appears when an item is selected */}
      {selectedItem && (
        <div className="absolute left-3 bottom-3 z-10 flex items-center gap-1 px-2 py-1.5 bg-white rounded-md shadow-md border border-zinc-200">
          <PropsForItem
            item={selectedItem}
            onChange={(patch) => updateItem(selectedItem.id, patch)}
            onDelete={() => deleteItem(selectedItem.id)}
          />
        </div>
      )}

      {/* Dotted infinite canvas */}
      <div
        ref={stageRef}
        className="flex-1 min-h-0 overflow-auto"
        style={{
          backgroundColor: '#fafafa',
          backgroundImage: 'radial-gradient(circle, #d4d4d8 1px, transparent 1.5px)',
          backgroundSize: '20px 20px',
          cursor: tool === 'select' ? 'default' : 'crosshair',
        }}
      >
        {/* Padding so the page is centered with breathing room when zoomed out. */}
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
              boxShadow: '0 6px 30px rgba(0,0,0,0.08)',
              position: 'relative',
              overflow: 'hidden',
              // The flow needs to give the scaled page actual layout space.
              marginBottom: page.height * (zoom - 1),
            }}
          >
            {page.items.map((item) => (
              <RenderedItem
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onPointerDown={(e) => handleItemPointerDown(e, item.id)}
                onResizePointerDown={(e) => handleResizePointerDown(e, item.id)}
                onTextChange={(text) =>
                  updateItem(item.id, { text } as Partial<TextItem>)
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Palette({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const btn = (id: Tool, Icon: typeof TypeIcon, title: string) => (
    <button
      key={id}
      onClick={() => setTool(id)}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        tool === id ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
      }`}
    >
      <Icon size={14} />
    </button>
  );
  return (
    <>
      {btn('select', MousePointer2, 'Select (V)')}
      <div className="w-px h-5 bg-zinc-200 mx-0.5" />
      {btn('text', TypeIcon, 'Text (T)')}
      {btn('rect', SquareIcon, 'Rectangle (R)')}
      {btn('ellipse', CircleIcon, 'Ellipse (O)')}
      {btn('image', ImageIconLuc, 'Image')}
    </>
  );
}

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
    left: item.x,
    top: item.y,
    width: item.w,
    height: item.h,
    boxSizing: 'border-box',
    cursor: 'move',
    outline: selected ? '2px solid #1B4FA7' : 'none',
    outlineOffset: 1,
  };
  let body: React.ReactNode = null;
  switch (item.type) {
    case 'text':
      body = (
        <EditableText
          item={item}
          onChange={onTextChange}
        />
      );
      break;
    case 'rect':
      body = (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: item.fill,
            border: `${item.strokeWidth}px solid ${item.stroke}`,
            borderRadius: item.radius,
          }}
        />
      );
      break;
    case 'ellipse':
      body = (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: item.fill,
            border: `${item.strokeWidth}px solid ${item.stroke}`,
            borderRadius: 9999,
          }}
        />
      );
      break;
    case 'image':
      body = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: item.fit, pointerEvents: 'none' }}
        />
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
            position: 'absolute',
            right: -6,
            bottom: -6,
            width: 12,
            height: 12,
            background: '#1B4FA7',
            borderRadius: 2,
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
  // contenteditable + onBlur for commit. Pointer events fall through when
  // not editing so drag works on the wrapping item.
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  // Sync DOM when item.text changes externally (e.g. font-size patch keeps text).
  useEffect(() => {
    if (ref.current && !editing) ref.current.innerText = item.text;
  }, [item.text, editing]);
  return (
    <div
      ref={ref}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
        const el = ref.current;
        if (el) {
          el.focus();
          const range = document.createRange();
          range.selectNodeContents(el);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        }
      }}
      onBlur={() => {
        setEditing(false);
        if (ref.current) onChange(ref.current.innerText);
      }}
      onPointerDown={(e) => { if (editing) e.stopPropagation(); }}
      contentEditable={editing}
      suppressContentEditableWarning
      style={{
        width: '100%',
        height: '100%',
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        color: item.color,
        textAlign: item.align,
        lineHeight: 1.4,
        fontFamily: item.fontFamily ?? 'inherit',
        cursor: editing ? 'text' : 'move',
        outline: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {/* initial render — controlled by useEffect afterwards */}
      {item.text}
    </div>
  );
}

function PropsForItem({
  item, onChange, onDelete,
}: {
  item: CanvasItem;
  onChange: (patch: Partial<CanvasItem>) => void;
  onDelete: () => void;
}) {
  const swatchRow = (key: 'fill' | 'color' | 'stroke', current: string) => (
    <div className="flex items-center gap-0.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => onChange({ [key]: c } as Partial<CanvasItem>)}
          title={c}
          style={{ background: c }}
          className={`w-4 h-4 rounded-sm border ${current === c ? 'border-zinc-900' : 'border-zinc-200'}`}
        />
      ))}
    </div>
  );
  return (
    <>
      {item.type === 'text' && (
        <>
          {FONT_PRESETS.map((f) => (
            <button
              key={f.label}
              onClick={() => onChange({ fontSize: f.size } as Partial<TextItem>)}
              className={`px-1.5 py-0.5 text-[11px] rounded ${
                (item as TextItem).fontSize === f.size
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() =>
              onChange({
                fontWeight: (item as TextItem).fontWeight >= 600 ? 400 : 700,
              } as Partial<TextItem>)
            }
            className={`p-1 rounded ${
              (item as TextItem).fontWeight >= 600
                ? 'bg-zinc-900 text-white'
                : 'text-zinc-700 hover:bg-zinc-100'
            }`}
            title="Bold"
          >
            <Bold size={12} />
          </button>
          <span className="w-px h-4 bg-zinc-200 mx-1" />
          {swatchRow('color', (item as TextItem).color)}
        </>
      )}
      {(item.type === 'rect' || item.type === 'ellipse') && (
        <>
          {swatchRow('fill', (item as RectItem | EllipseItem).fill)}
          {item.type === 'rect' && (
            <>
              <span className="w-px h-4 bg-zinc-200 mx-1" />
              <label className="text-[11px] text-zinc-500">radius</label>
              <input
                type="range"
                min={0}
                max={64}
                value={(item as RectItem).radius}
                onChange={(e) => onChange({ radius: Number(e.target.value) } as Partial<RectItem>)}
                className="w-20 h-1"
              />
            </>
          )}
        </>
      )}
      {item.type === 'image' && (
        <>
          <button
            onClick={() => onChange({ fit: (item as ImageItem).fit === 'cover' ? 'contain' : 'cover' } as Partial<ImageItem>)}
            className="px-1.5 py-0.5 text-[11px] rounded text-zinc-700 hover:bg-zinc-100"
          >
            {(item as ImageItem).fit}
          </button>
        </>
      )}
      <span className="w-px h-4 bg-zinc-200 mx-1" />
      <button
        onClick={onDelete}
        className="p-1 rounded text-zinc-500 hover:text-red-600 hover:bg-zinc-100"
        title="Delete (Del)"
      >
        <Trash2 size={12} />
      </button>
    </>
  );
}
