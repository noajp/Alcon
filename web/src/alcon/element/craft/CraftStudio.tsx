'use client';

// CraftStudio — Figma-Slides-style modal popup.
//
// Layout (dark theme):
//   ┌───────────────────────────────────────────────────────────┐
//   │  Top bar:  [logo] [view] · Untitled · Design / Animate   │
//   │           ……………… avatar / Share / Check out / X         │
//   ├──────────┬──────────────────────────────────────┬─────────┤
//   │ Slides   │  Center canvas (dotted background)   │ Design  │
//   │ rail     │     ┌──────── page ────────┐          │ panel   │
//   │          │     │                       │         │         │
//   │ 1 …      │     │                       │         │ Bg      │
//   │ 2 active │     │                       │         │ Style   │
//   │ +        │     └──────────────────────┘         │ Hex     │
//   │          │                                      │         │
//   │          │  ┌──── bottom popup toolbar ────┐    │         │
//   │          │  │ ⊕ T 🖼 ◫ ⓘ ⌘ +              │    │         │
//   │          │  └─────────────────────────────┘    │         │
//   └──────────┴──────────────────────────────────────┴─────────┘
//
// The bottom bar is the "popup with the functions" the user asked for —
// floating just above the bottom of the canvas area, Figma-style.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FileText, Presentation, Download, Printer, CheckCircle2,
  RotateCcw, Loader2, Wand2, Plus, Trash2, Copy,
  MousePointer2, Type as TypeIcon, Square as SquareIcon, Circle as CircleIcon,
  Image as ImageIconLuc, MessageSquare, Bold,
  PanelLeft, LayoutGrid, Play,
} from 'lucide-react';
import { CraftCanvas, type CanvasTool, type CraftCanvasHandle } from './CraftCanvas';
import { CraftIcon } from './CraftIcon';
import {
  CraftDoc, emptyDoc, makeText, PAGE_SIZE,
  TextItem, RectItem, EllipseItem, ImageItem, CanvasItem,
  addPageAfter, removePageAt, duplicatePageAt,
} from './canvasTypes';
import { renderDocToHtml } from './canvasRender';
import { loadSession, saveSession, clearSession } from './craftStore';
import { generateCraft } from './generateCraft';
import type { Craft, CraftFormat, CraftSession } from './types';

interface Props {
  element: { id: string; title: string; description?: string | null };
  initialFormat?: CraftFormat;
  onClose: () => void;
  onCheckOut: (craft: Craft) => void;
}

const MODE: Record<CraftFormat, { label: string; icon: typeof FileText; accent: string }> = {
  documentation: { label: 'Doc',   icon: FileText,     accent: '#1B4FA7' },
  presentation:  { label: 'Slide', icon: Presentation, accent: '#E2722C' },
};

const SWATCHES = ['#111111', '#ffffff', '#60A0D7', '#1B4FA7', '#0F2A52', '#B7410E', '#E2722C', '#3D7A4A', '#A3221C', '#D49A1A'];
const FONT_PRESETS: { label: string; size: number }[] = [
  { label: 'S', size: 14 },
  { label: 'M', size: 20 },
  { label: 'L', size: 32 },
  { label: 'XL', size: 56 },
];

function nowIso() { return new Date().toISOString(); }
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptySession(elementId: string, title: string, format: CraftFormat): CraftSession {
  return {
    element_id: elementId,
    title,
    format,
    messages: [],
    canvas: emptyDoc(format),
    draftHtml: null,
    updated_at: nowIso(),
  };
}

function ensureCanvas(session: CraftSession, format: CraftFormat): CraftSession {
  if (session.canvas && session.canvas.pages?.length) return session;
  return { ...session, canvas: emptyDoc(format) };
}

export function CraftStudio({ element, initialFormat = 'documentation', onClose, onCheckOut }: Props) {
  const [format, setFormat] = useState<CraftFormat>(initialFormat);
  const [session, setSession] = useState<CraftSession>(() => {
    const stored = loadSession(element.id, initialFormat);
    if (stored) return ensureCanvas(stored, initialFormat);
    return emptySession(element.id, 'Untitled', initialFormat);
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.45);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showThumbs, setShowThumbs] = useState(true);

  const canvasRef = useRef<CraftCanvasHandle>(null);
  const mode = MODE[format];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Switch format → load (or create) the matching session, resize pages.
  useEffect(() => {
    const stored = loadSession(element.id, format);
    const next = stored
      ? ensureCanvas(stored, format)
      : emptySession(element.id, 'Untitled', format);
    if (next.canvas.format !== format) {
      const size = PAGE_SIZE[format];
      next.canvas = {
        format,
        pages: next.canvas.pages.map((p) => ({ ...p, width: size.width, height: size.height })),
      };
    }
    setSession(next);
    setPageIndex(0);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, element.id]);

  useEffect(() => { saveSession(session); }, [session]);

  const renderedHtml = useMemo(() => renderDocToHtml(session.canvas), [session.canvas]);

  const currentPage = session.canvas.pages[pageIndex] ?? session.canvas.pages[0];
  const selectedItem = useMemo(
    () => currentPage?.items.find((it) => it.id === selectedId) ?? null,
    [currentPage, selectedId]
  );

  const handleCanvasChange = (canvas: CraftDoc) => {
    setSession((s) => ({ ...s, canvas, draftHtml: null, updated_at: nowIso() }));
  };

  const updateItem = (id: string, patch: Partial<CanvasItem>) => {
    handleCanvasChange({
      ...session.canvas,
      pages: session.canvas.pages.map((p, i) =>
        i === pageIndex
          ? { ...p, items: p.items.map((it) => (it.id === id ? ({ ...it, ...patch } as CanvasItem) : it)) }
          : p
      ),
    });
  };

  const setPageBackground = (color: string) => {
    handleCanvasChange({
      ...session.canvas,
      pages: session.canvas.pages.map((p, i) => (i === pageIndex ? { ...p, background: color } : p)),
    });
  };

  const handleAddPage = () => {
    const { doc, newIndex } = addPageAfter(session.canvas, pageIndex);
    handleCanvasChange(doc);
    setPageIndex(newIndex);
    setSelectedId(null);
  };

  const handleDuplicatePage = () => {
    const { doc, newIndex } = duplicatePageAt(session.canvas, pageIndex);
    handleCanvasChange(doc);
    setPageIndex(newIndex);
    setSelectedId(null);
  };

  const handleRemovePage = () => {
    if (session.canvas.pages.length <= 1) return;
    const { doc, newIndex } = removePageAt(session.canvas, pageIndex);
    handleCanvasChange(doc);
    setPageIndex(newIndex);
    setSelectedId(null);
  };

  const handleReset = () => {
    if (!confirm('現在のキャンバスを破棄します。よろしいですか?')) return;
    setSession(emptySession(element.id, 'Untitled', format));
    setPageIndex(0);
    setSelectedId(null);
  };

  const handleDownload = () => {
    const blob = new Blob([renderedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(session.title || 'craft').replace(/[^a-zA-Z0-9._-]/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    const w = window.open('', '_blank', 'width=1200,height=900');
    if (!w) return;
    const size = PAGE_SIZE[format];
    const pageRule =
      format === 'presentation'
        ? `@page { size: ${size.width}px ${size.height}px; margin: 0; }`
        : `@page { size: A4; margin: 0; }`;
    const printCss = `<style>${pageRule} html, body { margin: 0; padding: 0; }</style>`;
    const doc = renderedHtml.includes('</head>')
      ? renderedHtml.replace('</head>', `${printCss}</head>`)
      : printCss + renderedHtml;
    w.document.open();
    w.document.write(doc);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  };

  const handleCheckOut = () => {
    const craft: Craft = {
      id: newId('craft'),
      element_id: element.id,
      title: session.title || `${element.title} — ${mode.label}`,
      format,
      html: renderedHtml,
      canvas: session.canvas,
      status: 'final',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    onCheckOut(craft);
    clearSession(element.id, format);
    onClose();
  };

  const handleAiGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await generateCraft({
        element: { title: element.title, description: element.description ?? null },
        format,
        prompt,
        history: [],
        currentHtml: null,
      });
      if (result.html) {
        const text = stripHtml(result.html).slice(0, 4000);
        setSession((s) => {
          const page0 = s.canvas.pages[pageIndex] ?? s.canvas.pages[0];
          const item = makeText(60, 60, format);
          item.text = text;
          item.w = page0.width - 120;
          item.h = page0.height - 120;
          item.fontSize = format === 'presentation' ? 24 : 14;
          return {
            ...s,
            canvas: {
              ...s.canvas,
              pages: s.canvas.pages.map((p, i) =>
                i === pageIndex ? { ...p, items: [...p.items, item] } : p
              ),
            },
            updated_at: nowIso(),
          };
        });
      }
      setAiOpen(false);
      setAiPrompt('');
    } catch (e) {
      setAiError((e as Error).message || 'AI generation failed');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="w-full h-full max-w-[1500px] max-h-[920px] bg-[#1e1e1e] text-zinc-200 rounded-lg shadow-2xl flex flex-col overflow-hidden border border-zinc-800">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 px-3 h-12 border-b border-zinc-800 shrink-0">
          {/* Left: brand stub + view toggles */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded bg-zinc-800 flex items-center justify-center text-[#F24E1E]">
              <CraftIcon size={15} />
            </div>
            <div className="flex items-center gap-0.5">
              <IconBtn active={showThumbs} onClick={() => setShowThumbs((v) => !v)} title="Toggle slides rail">
                <PanelLeft size={14} />
              </IconBtn>
              <IconBtn onClick={() => {}} title="Grid view (coming soon)" disabled>
                <LayoutGrid size={14} />
              </IconBtn>
            </div>
            <div className="ml-2 flex items-baseline gap-1.5 min-w-0">
              <input
                value={session.title}
                onChange={(e) => setSession({ ...session, title: e.target.value, updated_at: nowIso() })}
                className="bg-transparent text-[13px] font-medium border-none focus:outline-none w-44 truncate"
              />
              <span className="text-[10.5px] text-zinc-500">{element.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Free</span>
            </div>
          </div>

          {/* Center: format tabs */}
          <div className="flex items-center bg-zinc-900 rounded-md p-0.5">
            {(Object.keys(MODE) as CraftFormat[]).map((f) => {
              const t = MODE[f];
              const Icon = t.icon;
              const active = f === format;
              return (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex items-center gap-1.5 px-2.5 h-7 text-[11.5px] font-medium rounded transition-colors ${
                    active ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  <Icon size={12} />
                  {f === 'documentation' ? 'Document' : 'Slides'}
                </button>
              );
            })}
          </div>

          {/* Right: AI / utilities / Share / Check out / Close */}
          <div className="flex items-center gap-1">
            <IconBtn onClick={() => setAiOpen(true)} title="AI assist">
              <Wand2 size={14} />
            </IconBtn>
            <IconBtn onClick={handleReset} title="Reset canvas">
              <RotateCcw size={14} />
            </IconBtn>
            <IconBtn onClick={handleDownload} title="Download HTML">
              <Download size={14} />
            </IconBtn>
            <IconBtn onClick={handlePrintPdf} title="Save as PDF (browser print)">
              <Printer size={14} />
            </IconBtn>
            <IconBtn onClick={() => {}} title="Present (coming soon)" disabled>
              <Play size={14} />
            </IconBtn>
            <button
              onClick={handleCheckOut}
              className="flex items-center gap-1.5 px-3 h-7 ml-1 text-[12px] font-medium text-white rounded transition-colors"
              style={{ background: '#F24E1E' }}
              title="Check out — attach to Element + bump status to review"
            >
              <CheckCircle2 size={12} /> Check out
            </button>
            <button
              onClick={onClose}
              className="p-1.5 ml-0.5 text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body — three columns */}
        <div className="flex-1 min-h-0 grid" style={{
          gridTemplateColumns: `${showThumbs ? '232px' : '0px'} 1fr 260px`,
          transition: 'grid-template-columns 150ms ease',
        }}>
          {/* Left: slides rail */}
          {showThumbs && (
            <aside className="bg-[#181818] border-r border-zinc-800 flex flex-col min-h-0">
              <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wider text-zinc-500">
                <span>{format === 'presentation' ? 'Slides' : 'Pages'}</span>
                <button
                  onClick={handleAddPage}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-zinc-300 hover:bg-zinc-800"
                  title="New page"
                >
                  <Plus size={11} /> New
                </button>
              </div>
              <div className="flex-1 overflow-auto px-2 pb-3 space-y-1.5">
                {session.canvas.pages.map((p, i) => (
                  <PageThumb
                    key={p.id}
                    index={i}
                    page={p}
                    active={i === pageIndex}
                    onSelect={() => { setPageIndex(i); setSelectedId(null); }}
                    onDuplicate={() => { setPageIndex(i); handleDuplicatePage(); }}
                    onRemove={() => { setPageIndex(i); handleRemovePage(); }}
                    canRemove={session.canvas.pages.length > 1}
                  />
                ))}
              </div>
            </aside>
          )}

          {/* Center: canvas + bottom toolbar popup */}
          <section className="relative min-h-0 flex flex-col">
            <CraftCanvas
              ref={canvasRef}
              doc={session.canvas}
              pageIndex={pageIndex}
              onChange={handleCanvasChange}
              tool={tool}
              onToolChange={setTool}
              selectedId={selectedId}
              onSelect={setSelectedId}
              zoom={zoom}
              onZoomChange={setZoom}
            />

            {/* Bottom popup toolbar — the "機能を下にポップアップ" the user asked for */}
            <div className="absolute left-1/2 bottom-5 -translate-x-1/2 z-10 flex items-center gap-1 px-2 h-11 bg-[#2c2c2c] rounded-xl shadow-2xl border border-zinc-700/60">
              <ToolBtn active={tool === 'select'} accent={mode.accent} onClick={() => setTool('select')} title="Select (V)">
                <MousePointer2 size={15} />
              </ToolBtn>
              <ToolBtn active={tool === 'text'} accent={mode.accent} onClick={() => setTool('text')} title="Text (T)">
                <TypeIcon size={15} />
              </ToolBtn>
              <ToolBtn active={tool === 'image'} accent={mode.accent} onClick={() => setTool('image')} title="Image">
                <ImageIconLuc size={15} />
              </ToolBtn>
              <ToolBtn active={tool === 'rect'} accent={mode.accent} onClick={() => setTool('rect')} title="Rectangle (R)">
                <SquareIcon size={15} />
              </ToolBtn>
              <ToolBtn active={tool === 'ellipse'} accent={mode.accent} onClick={() => setTool('ellipse')} title="Ellipse (O)">
                <CircleIcon size={15} />
              </ToolBtn>
              <Divider />
              <ToolBtn onClick={handleDuplicatePage} title="Duplicate page">
                <Copy size={14} />
              </ToolBtn>
              <ToolBtn onClick={() => setAiOpen(true)} title="AI assist">
                <Wand2 size={14} />
              </ToolBtn>
              <ToolBtn onClick={() => {}} title="Comments (coming soon)" disabled>
                <MessageSquare size={14} />
              </ToolBtn>
              <ToolBtn onClick={handleAddPage} title="Add page">
                <Plus size={15} />
              </ToolBtn>
              <Divider />
              <div className="flex items-center text-[11px] text-zinc-400 px-1.5">
                <button onClick={() => setZoom((z) => Math.max(0.2, +(z - 0.05).toFixed(2)))} className="px-1 hover:text-zinc-100">−</button>
                <span className="tabular-nums w-9 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((z) => Math.min(2, +(z + 0.05).toFixed(2)))} className="px-1 hover:text-zinc-100">+</button>
              </div>
            </div>
          </section>

          {/* Right: design panel */}
          <aside className="bg-[#1a1a1a] border-l border-zinc-800 flex flex-col min-h-0">
            <DesignPanel
              format={format}
              pageIndex={pageIndex}
              page={currentPage}
              selectedItem={selectedItem}
              onUpdateItem={updateItem}
              onPageBackground={setPageBackground}
            />
          </aside>
        </div>

        {/* AI prompt — modal-in-modal */}
        {aiOpen && (
          <div className="absolute inset-0 z-30 bg-black/40 flex items-center justify-center" onClick={() => setAiOpen(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[480px] bg-[#1e1e1e] border border-zinc-800 rounded-lg shadow-2xl p-4 space-y-3 text-zinc-200"
            >
              <div className="flex items-center gap-2">
                <Wand2 size={14} className="text-amber-400" />
                <span className="text-[13px] font-medium">AI に下書きを作らせる</span>
              </div>
              <p className="text-[11.5px] text-zinc-400">
                生成された本文がアクティブなページに 1 つのテキストブロックとして配置されます。
                その後ドラッグ / 編集 / 分割は手動でどうぞ。
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例: 5 枚構成のピッチデッキを作って"
                rows={3}
                className="w-full text-[13px] bg-zinc-900 rounded px-2.5 py-2 resize-none border border-transparent focus:outline-none"
              />
              {aiError && <div className="text-[12px] text-red-400">{aiError}</div>}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setAiOpen(false)} className="px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-zinc-800 rounded">
                  Cancel
                </button>
                <button
                  onClick={handleAiGenerate}
                  disabled={!aiPrompt.trim() || aiBusy}
                  className="px-3 py-1.5 text-[12px] font-medium text-white rounded disabled:opacity-40 flex items-center gap-1.5"
                  style={{ background: '#F24E1E' }}
                >
                  {aiBusy && <Loader2 size={12} className="animate-spin" />}
                  Generate
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- subcomponents ----------

function IconBtn({ onClick, title, children, active, disabled }: {
  onClick: () => void; title: string; children: React.ReactNode; active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

function ToolBtn({ onClick, title, children, active, disabled, accent }: {
  onClick: () => void; title: string; children: React.ReactNode; active?: boolean; disabled?: boolean; accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:bg-zinc-700"
      style={active ? { background: accent ?? '#F24E1E', color: '#fff' } : undefined}
    >
      {children}
    </button>
  );
}

function Divider() { return <span className="w-px h-5 bg-zinc-700 mx-0.5" />; }

function PageThumb({
  index, page, active, onSelect, onDuplicate, onRemove, canRemove,
}: {
  index: number;
  page: { id: string; width: number; height: number; background: string; items: CanvasItem[] };
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  // Render a tiny scaled preview of the page so items roughly show through.
  const scale = 200 / page.width;
  return (
    <div className="group relative">
      <div className="flex items-start gap-2">
        <span className="text-[11px] text-zinc-500 pt-1.5 w-3 text-right tabular-nums">{index + 1}</span>
        <button
          onClick={onSelect}
          className={`flex-1 rounded overflow-hidden border-2 transition-colors ${
            active ? 'border-[#F24E1E]' : 'border-transparent hover:border-zinc-700'
          }`}
          style={{ background: page.background, height: page.height * scale, position: 'relative' }}
        >
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: page.width, height: page.height, position: 'relative' }}>
            {page.items.slice(0, 30).map((it) => (
              <div
                key={it.id}
                style={{
                  position: 'absolute', left: it.x, top: it.y, width: it.w, height: it.h,
                  background: it.type === 'text' ? 'transparent' : (it as RectItem | EllipseItem).fill,
                  borderRadius: it.type === 'ellipse' ? 9999 : it.type === 'rect' ? (it as RectItem).radius : 0,
                  color: it.type === 'text' ? (it as TextItem).color : undefined,
                  fontSize: it.type === 'text' ? (it as TextItem).fontSize : undefined,
                  fontWeight: it.type === 'text' ? (it as TextItem).fontWeight : undefined,
                  textAlign: it.type === 'text' ? (it as TextItem).align : undefined,
                  overflow: 'hidden',
                }}
              >
                {it.type === 'text' ? (it as TextItem).text : null}
              </div>
            ))}
          </div>
        </button>
      </div>
      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
        <button onClick={onDuplicate} className="p-0.5 rounded bg-zinc-900/80 text-zinc-300 hover:text-white" title="Duplicate">
          <Copy size={10} />
        </button>
        {canRemove && (
          <button onClick={onRemove} className="p-0.5 rounded bg-zinc-900/80 text-zinc-300 hover:text-red-400" title="Delete">
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function DesignPanel({
  format, pageIndex, page, selectedItem, onUpdateItem, onPageBackground,
}: {
  format: CraftFormat;
  pageIndex: number;
  page: { width: number; height: number; background: string };
  selectedItem: CanvasItem | null;
  onUpdateItem: (id: string, patch: Partial<CanvasItem>) => void;
  onPageBackground: (color: string) => void;
}) {
  const tabClass = (active: boolean) =>
    `px-3 py-1 text-[12px] rounded transition-colors ${active ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-100'}`;
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-800">
        <div className="flex items-center gap-1">
          <button className={tabClass(true)}>Design</button>
          <button className={tabClass(false)} disabled>Animate</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        <div>
          <div className="text-[12.5px] font-semibold text-zinc-100">
            {format === 'presentation' ? 'Slide' : 'Page'} {pageIndex + 1}
          </div>
          <div className="text-[10.5px] text-zinc-500 mt-0.5">{page.width} × {page.height}</div>
        </div>

        {/* Background */}
        <Section title="Background">
          <div className="flex items-center gap-1 flex-wrap">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => onPageBackground(c)}
                title={c}
                style={{ background: c }}
                className={`w-6 h-6 rounded border ${page.background === c ? 'border-white' : 'border-zinc-700'}`}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={normalizeHex(page.background)}
              onChange={(e) => onPageBackground(e.target.value)}
              className="w-6 h-6 bg-transparent border-none rounded"
            />
            <input
              value={page.background}
              onChange={(e) => onPageBackground(e.target.value)}
              className="flex-1 bg-zinc-900 text-[12px] font-mono px-2 py-1 rounded border border-transparent focus:outline-none"
            />
          </div>
        </Section>

        {/* Selected item properties */}
        {selectedItem ? (
          <Section title={`${selectedItem.type[0].toUpperCase()}${selectedItem.type.slice(1)} layer`}>
            <ItemProps item={selectedItem} onUpdate={(patch) => onUpdateItem(selectedItem.id, patch)} />
          </Section>
        ) : (
          <Section title="Layer">
            <p className="text-[11.5px] text-zinc-500">レイヤーをクリックすると、ここでスタイル / 位置を編集できます。</p>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-500">
        <span>{title}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ItemProps({ item, onUpdate }: { item: CanvasItem; onUpdate: (patch: Partial<CanvasItem>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <NumField label="X" value={item.x} onChange={(v) => onUpdate({ x: v } as Partial<CanvasItem>)} />
        <NumField label="Y" value={item.y} onChange={(v) => onUpdate({ y: v } as Partial<CanvasItem>)} />
        <NumField label="W" value={item.w} onChange={(v) => onUpdate({ w: v } as Partial<CanvasItem>)} />
        <NumField label="H" value={item.h} onChange={(v) => onUpdate({ h: v } as Partial<CanvasItem>)} />
      </div>

      {item.type === 'text' && (
        <>
          <SwatchRow
            label="Color"
            current={(item as TextItem).color}
            onChange={(c) => onUpdate({ color: c } as Partial<TextItem>)}
          />
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Font</div>
            <div className="flex items-center gap-1">
              {FONT_PRESETS.map((f) => (
                <button
                  key={f.label}
                  onClick={() => onUpdate({ fontSize: f.size } as Partial<TextItem>)}
                  className={`px-2 py-1 text-[11px] rounded ${
                    (item as TextItem).fontSize === f.size ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <button
                onClick={() => onUpdate({ fontWeight: (item as TextItem).fontWeight >= 600 ? 400 : 700 } as Partial<TextItem>)}
                className={`p-1.5 rounded ${
                  (item as TextItem).fontWeight >= 600 ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'
                }`}
                title="Bold"
              >
                <Bold size={12} />
              </button>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-zinc-500 mb-1">Align</div>
            <div className="flex items-center gap-1">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => onUpdate({ align: a } as Partial<TextItem>)}
                  className={`px-2 py-1 text-[11px] rounded capitalize ${
                    (item as TextItem).align === a ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {(item.type === 'rect' || item.type === 'ellipse') && (
        <SwatchRow
          label="Fill"
          current={(item as RectItem | EllipseItem).fill}
          onChange={(c) => onUpdate({ fill: c } as Partial<CanvasItem>)}
        />
      )}

      {item.type === 'rect' && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1">Corner radius</div>
          <input
            type="range"
            min={0}
            max={64}
            value={(item as RectItem).radius}
            onChange={(e) => onUpdate({ radius: Number(e.target.value) } as Partial<RectItem>)}
            className="w-full"
          />
        </div>
      )}

      {item.type === 'image' && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1">Fit</div>
          <div className="flex items-center gap-1">
            {(['cover', 'contain'] as const).map((f) => (
              <button
                key={f}
                onClick={() => onUpdate({ fit: f } as Partial<ImageItem>)}
                className={`px-2 py-1 text-[11px] rounded capitalize ${
                  (item as ImageItem).fit === f ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 bg-zinc-900 rounded px-2 py-1">
      <span className="text-[10.5px] text-zinc-500 w-3">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent text-[12px] font-mono w-full focus:outline-none"
      />
    </label>
  );
}

function SwatchRow({ label, current, onChange }: { label: string; current: string; onChange: (c: string) => void }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
      <div className="flex items-center gap-1 flex-wrap">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            style={{ background: c }}
            className={`w-5 h-5 rounded-sm border ${current === c ? 'border-white' : 'border-zinc-700'}`}
          />
        ))}
      </div>
    </div>
  );
}

function normalizeHex(c: string): string {
  // <input type="color"> expects #rrggbb. Accept any string and best-effort.
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    const [_, r, g, b] = c.match(/^#(.)(.)(.)$/i)!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#ffffff';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
