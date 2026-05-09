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
  Image as ImageIconLuc, MessageSquare, Bold, Italic, Strikethrough,
  Underline as UnderlineIcon, Eraser,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  IndentDecrease, IndentIncrease,
  PanelLeft, LayoutGrid, Play, Sliders, ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/ui/dropdown-menu';
import { CraftCanvas, type CanvasTool, type CraftCanvasHandle } from './CraftCanvas';
import { DocEditor } from './DocEditor';
import { CraftIcon } from './CraftIcon';
import {
  CraftDoc, emptyDoc, makeText, PAGE_SIZE,
  TextItem, RectItem, EllipseItem, ImageItem, CanvasItem,
  addPageAfter, removePageAt, duplicatePageAt,
} from './canvasTypes';
import { renderDocToHtml, renderDocFlowToHtml } from './canvasRender';
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
  // Shared with DocEditor + DocSidePanel so the sidebar can run
  // execCommand / inline-style ops on the same selection.
  const docEditorRef = useRef<HTMLDivElement>(null);

  // Run a built-in execCommand against the doc editor. Sidebar buttons
  // already use onMouseDown + preventDefault so focus stays inside the
  // editor and the selection survives.
  const docCmd = (command: string, value?: string) => {
    const el = docEditorRef.current;
    if (!el) return;
    el.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* ignore */ }
    try { document.execCommand(command, false, value); } catch { /* ignore */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Wrap the current selection in a <span> with arbitrary inline CSS.
  // Used for things execCommand can't do natively (font-size in px,
  // line-height, font-family with arbitrary names).
  const docInlineStyle = (cssText: string) => {
    const el = docEditorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const span = document.createElement('span');
    span.style.cssText = cssText;
    try {
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
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

  // Documentation mode = flow HTML (session.draftHtml). Presentation mode
  // = absolute-positioned canvas (session.canvas). The studio rebuilds the
  // exported HTML from whichever source the active mode owns.
  const isDoc = format === 'documentation';
  const renderedHtml = useMemo(() => {
    if (isDoc) {
      return renderDocFlowToHtml({
        body: session.draftHtml ?? '',
        title: session.title || `${element.title} — Documentation`,
        elementName: element.title,
      });
    }
    return renderDocToHtml(session.canvas);
  }, [isDoc, session.canvas, session.draftHtml, session.title, element.title]);

  // Doc mode commits straight into session.draftHtml.
  const handleDocHtmlChange = (html: string) => {
    setSession((s) => ({ ...s, draftHtml: html, updated_at: nowIso() }));
  };

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
    const message = isDoc
      ? '現在のドキュメントを破棄します。よろしいですか?'
      : '現在のキャンバスを破棄します。よろしいですか?';
    if (!confirm(message)) return;
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
    // canvas is only meaningful for Presentation. Doc mode persists its
    // body via Craft.html (the rendered shell) and re-edits from the
    // session.draftHtml in localStorage.
    const craft: Craft = {
      id: newId('craft'),
      element_id: element.id,
      title: session.title || `${element.title} — ${mode.label}`,
      format,
      html: renderedHtml,
      ...(isDoc ? {} : { canvas: session.canvas }),
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
        if (isDoc) {
          // Doc mode: replace the editor body with the AI-generated body
          // contents (stripped of <html>/<head>/<body> wrappers).
          const body = extractBody(result.html);
          setSession((s) => ({
            ...s,
            draftHtml: (s.draftHtml ? s.draftHtml + '\n' : '') + body,
            updated_at: nowIso(),
          }));
        } else {
          // Slide mode: stamp the body text into a single canvas item.
          const text = stripHtml(result.html).slice(0, 4000);
          setSession((s) => {
            const page0 = s.canvas.pages[pageIndex] ?? s.canvas.pages[0];
            const item = makeText(60, 60, format);
            item.text = text;
            item.w = page0.width - 120;
            item.h = page0.height - 120;
            item.fontSize = 24;
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
      <div className="w-full h-full max-w-[1500px] max-h-[920px] bg-white dark:bg-[#1e1e1e] text-zinc-900 dark:text-zinc-200 rounded-lg shadow-2xl flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {/* ── Top bar — Figma Slides parity ───────────────────────────
            Left: brand mark + view toggles. Utility actions (reset,
            download, PDF) live behind the brand-mark dropdown.
            Right: AI quick-action + decorative avatar + Play (disabled)
            + ORANGE Check out button + Close. */}
        <div className="flex items-center justify-between gap-3 px-3 h-12 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-7 h-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[#F24E1E] hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  title="File menu"
                >
                  <CraftIcon size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={handleReset} className="gap-2 text-[12px]">
                  <RotateCcw size={12} /> Reset
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownload} className="gap-2 text-[12px]">
                  <Download size={12} /> Download HTML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePrintPdf} className="gap-2 text-[12px]">
                  <Printer size={12} /> Save as PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onClose} className="gap-2 text-[12px]">
                  <X size={12} /> Close (auto-saved)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center gap-0.5">
              <IconBtn active={showThumbs} onClick={() => setShowThumbs((v) => !v)} title="Toggle slides rail">
                <PanelLeft size={14} />
              </IconBtn>
              <IconBtn onClick={() => {}} title="Grid view (coming soon)" disabled>
                <LayoutGrid size={14} />
              </IconBtn>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <IconBtn onClick={() => setAiOpen(true)} title="AI assist">
              <Wand2 size={14} />
            </IconBtn>
            {/* Decorative avatar — kept for visual parity with Figma. */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-amber-500" aria-hidden />
            <IconBtn onClick={() => {}} title="Present (coming soon)" disabled>
              <Play size={14} />
            </IconBtn>
            <button
              onClick={handleCheckOut}
              className="flex items-center gap-1.5 px-3 h-8 ml-0.5 text-[12px] font-medium text-white rounded-md transition-colors"
              style={{ background: '#F24E1E' }}
              title="Check out — attach to Element + bump status to review"
            >
              <CheckCircle2 size={12} /> Check out
            </button>
            <button
              onClick={onClose}
              className="p-1.5 ml-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
              title="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body — three columns. Both modes use the same Figma-style shell:
            left rail with format header + thumbnails, center canvas /
            editor, right inspector. */}
        <div className="flex-1 min-h-0 grid" style={{
          gridTemplateColumns: `${showThumbs ? '232px' : '0px'} 1fr 260px`,
          transition: 'grid-template-columns 150ms ease',
        }}>
          {/* Left: format header + thumbnails */}
          {showThumbs && (
            <aside className="bg-zinc-50 dark:bg-[#181818] border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0">
              <div className="px-3 pt-3 pb-2 space-y-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-1 -mx-1 px-1 py-0.5 rounded text-[15px] font-semibold text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                      <span>{isDoc ? 'Documentation' : 'Presentation'}</span>
                      <ChevronDown size={13} className="text-zinc-500" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {(Object.keys(MODE) as CraftFormat[]).map((f) => (
                      <DropdownMenuItem
                        key={f}
                        onClick={() => setFormat(f)}
                        className="gap-2 text-[12px]"
                      >
                        {f === 'documentation' ? 'Documentation' : 'Presentation'}
                        {f === format && <CheckCircle2 size={12} className="ml-auto text-emerald-500" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Drafts</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">Free</span>
                </div>
              </div>

              <div className="px-3 pb-2 flex items-center gap-1">
                <button
                  onClick={handleAddPage}
                  className="flex-1 flex items-center justify-between px-2 h-7 text-[11.5px] text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <span>{isDoc ? 'New page' : 'New slide'}</span>
                  <ChevronDown size={11} className="text-zinc-500" />
                </button>
                <button
                  onClick={handleAddPage}
                  className="w-7 h-7 flex items-center justify-center text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  title={isDoc ? 'Add page' : 'Add slide'}
                >
                  <Plus size={13} />
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

          {/* Center: format-specific editor */}
          {isDoc ? (
            <section className="relative min-h-0 flex flex-col">
              <DocEditor
                html={session.draftHtml ?? ''}
                onChange={handleDocHtmlChange}
                editorRef={docEditorRef}
                accent={mode.accent}
              />
            </section>
          ) : (
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

              {/* Bottom popup toolbar — Presentation only (the DocEditor
                  hosts its own toolbar). */}
              {/* Bottom popup toolbar — Figma Slides parity. The orange
                  Select-with-dropdown leads the bar; presenter/outline
                  view toggles sit on the far right after a divider. */}
              <div className="absolute left-1/2 bottom-5 -translate-x-1/2 z-10 flex items-center gap-1 px-1.5 h-12 bg-[#2c2c2c] rounded-2xl shadow-2xl border border-zinc-700/60">
                {/* Orange split button — Select tool + dropdown handle */}
                <div className="flex items-center bg-[#F24E1E] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setTool('select')}
                    title="Select (V)"
                    className="px-2.5 h-9 flex items-center justify-center text-white"
                  >
                    <MousePointer2 size={15} />
                  </button>
                  <button
                    title="Move tools"
                    className="px-1 h-9 flex items-center text-white/85 hover:text-white border-l border-white/20"
                  >
                    <ChevronDown size={11} />
                  </button>
                </div>
                <ToolBtn active={tool === 'text'} accent={mode.accent} onClick={() => setTool('text')} title="Text (T)">
                  <TypeIcon size={15} />
                </ToolBtn>
                <ToolBtn active={tool === 'image'} accent={mode.accent} onClick={() => setTool('image')} title="Image">
                  <ImageIconLuc size={15} />
                </ToolBtn>
                {/* Shape — currently routed to rect; ellipse switches via right-panel layer props */}
                <ToolBtn active={tool === 'rect' || tool === 'ellipse'} accent={mode.accent} onClick={() => setTool('rect')} title="Shapes">
                  <SquareIcon size={15} />
                </ToolBtn>
                <ToolBtn onClick={() => setAiOpen(true)} title="AI assist">
                  <Wand2 size={14} />
                </ToolBtn>
                <ToolBtn onClick={() => {}} title="Comments (coming soon)" disabled>
                  <MessageSquare size={14} />
                </ToolBtn>
                <ToolBtn onClick={handleAddPage} title="Add">
                  <Plus size={15} />
                </ToolBtn>
                <Divider />
                <ToolBtn onClick={() => {}} title="Presenter view (coming soon)" disabled>
                  <PresenterIcon />
                </ToolBtn>
                <ToolBtn onClick={() => {}} title="Outline view (coming soon)" disabled>
                  <OutlineIcon />
                </ToolBtn>
              </div>
            </section>
          )}

          {/* Right: design panel */}
          <aside className="bg-zinc-50 dark:bg-[#1a1a1a] border-l border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0">
            {isDoc ? (
              <DocSidePanel
                title={session.title}
                onTitleChange={(t) => setSession({ ...session, title: t, updated_at: nowIso() })}
                bodyHtml={session.draftHtml ?? ''}
                onCommand={docCmd}
                onInlineStyle={docInlineStyle}
                page={currentPage}
                pageIndex={pageIndex}
                onPageBackground={setPageBackground}
              />
            ) : (
              <DesignPanel
                format={format}
                pageIndex={pageIndex}
                page={currentPage}
                selectedItem={selectedItem}
                onUpdateItem={updateItem}
                onPageBackground={setPageBackground}
                zoom={zoom}
                onZoomChange={setZoom}
              />
            )}
          </aside>
        </div>

        {/* AI prompt — modal-in-modal */}
        {aiOpen && (
          <div className="absolute inset-0 z-30 bg-black/40 flex items-center justify-center" onClick={() => setAiOpen(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[480px] bg-white dark:bg-[#1e1e1e] border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl p-4 space-y-3 text-zinc-900 dark:text-zinc-200"
            >
              <div className="flex items-center gap-2">
                <Wand2 size={14} className="text-amber-400" />
                <span className="text-[13px] font-medium">AI に下書きを作らせる</span>
              </div>
              <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                生成された本文がアクティブなページに 1 つのテキストブロックとして配置されます。
                その後ドラッグ / 編集 / 分割は手動でどうぞ。
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例: 5 枚構成のピッチデッキを作って"
                rows={3}
                className="w-full text-[13px] bg-zinc-100 dark:bg-zinc-900 rounded px-2.5 py-2 resize-none border border-transparent focus:outline-none"
              />
              {aiError && <div className="text-[12px] text-red-400">{aiError}</div>}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setAiOpen(false)} className="px-3 py-1.5 text-[12px] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
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
        active ? 'bg-zinc-900 dark:bg-zinc-700 text-white' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
      className="p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-zinc-700 dark:text-zinc-300 hover:bg-zinc-700"
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
            active ? 'border-[#F24E1E]' : 'border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
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
        <button onClick={onDuplicate} className="p-0.5 rounded bg-white/80 dark:bg-zinc-900/80 text-zinc-700 dark:text-zinc-300 hover:text-white" title="Duplicate">
          <Copy size={10} />
        </button>
        {canRemove && (
          <button onClick={onRemove} className="p-0.5 rounded bg-white/80 dark:bg-zinc-900/80 text-zinc-700 dark:text-zinc-300 hover:text-red-400" title="Delete">
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

// Side panel for Documentation mode. Replaces the slide-centric Design
// panel. Shows the title input + a live document outline parsed from
// h1/h2/h3 tags + an AI assist shortcut.
// Word-like side panel for Documentation mode. All buttons use
// onMouseDown + preventDefault so the editor never loses focus and
// commands target the live caret / selection.
const DOC_FONTS = [
  { label: 'Default', value: 'system-ui, -apple-system, "Inter", sans-serif' },
  { label: 'Inter',   value: '"Inter", system-ui, sans-serif' },
  { label: 'Serif',   value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono',    value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];
const DOC_FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48];
const DOC_LINE_HEIGHTS: { label: string; value: string }[] = [
  { label: '1.0', value: '1' },
  { label: '1.25', value: '1.25' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
];
const DOC_TEXT_COLORS = [
  '#111111', '#374151', '#6b7280', '#9ca3af',
  '#1B4FA7', '#0F2A52', '#3D7A4A', '#D49A1A',
  '#B7410E', '#A3221C', '#8b5cf6', '#dc2626',
];
const DOC_HIGHLIGHTS = [
  'transparent', '#fef3c7', '#fee2e2', '#dcfce7',
  '#dbeafe', '#fce7f3', '#e9d5ff', '#fef08a',
];

function DocSidePanel({
  title, onTitleChange, bodyHtml, onCommand, onInlineStyle, page, pageIndex, onPageBackground,
}: {
  title: string;
  onTitleChange: (t: string) => void;
  bodyHtml: string;
  onCommand: (command: string, value?: string) => void;
  onInlineStyle: (cssText: string) => void;
  page: { width: number; height: number; background: string };
  pageIndex: number;
  onPageBackground: (color: string) => void;
}) {
  const headings = useMemo(() => parseHeadings(bodyHtml), [bodyHtml]);
  const bgName = colorName(page.background);

  // Wrapper: each button's mousedown preventDefault keeps the editor
  // focused so the selection survives. We only fire the actual command
  // on click (after focus has been preserved through mousedown).
  const md = (run: () => void) => ({
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); run(); },
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Design / Animate tabs — shell parity with Slide mode. Doc has
          no real "zoom" so the slot stays empty. */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3 text-[13px]">
          <button className="font-semibold text-zinc-900 dark:text-white">Design</button>
          <button className="text-zinc-400 dark:text-zinc-500 cursor-not-allowed" disabled>Animate</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Page N + layout icon — mirrors Slide mode's "Slide N" row. */}
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold text-zinc-900 dark:text-white">Page {pageIndex + 1}</span>
          <button
            className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
            title="Page layout (coming soon)"
          >
            <Sliders size={13} />
          </button>
        </div>

        <Section title="Title">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="w-full bg-zinc-100 dark:bg-zinc-900 text-[12px] px-2.5 py-1.5 rounded border border-transparent focus:outline-none"
          />
        </Section>

        <Section title="Template style" titleAction={
          <button className="p-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" title="Edit template">
            <Sliders size={11} />
          </button>
        }>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900">
            <div className="w-9 h-7 rounded-sm overflow-hidden flex shrink-0 border border-zinc-300 dark:border-zinc-700">
              <div className="flex-1 bg-white" />
              <div className="flex-1 bg-zinc-100" />
              <div className="flex-1 bg-[#0F2A52]" />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-zinc-900 dark:text-white truncate">Document</div>
              <div className="text-[10.5px] text-zinc-500 truncate">Inter · Serif</div>
            </div>
          </div>
        </Section>

        <Section title="Background">
          <div className="flex items-center gap-1 mb-2">
            <SegBtn active title="Solid"><FillSquare /></SegBtn>
            <SegBtn disabled title="Gradient (coming soon)"><GradientSquare /></SegBtn>
            <SegBtn disabled title="Image (coming soon)"><ImageIconLuc size={12} /></SegBtn>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900">
            <span className="w-4 h-4 rounded-sm border border-zinc-300 dark:border-zinc-700 shrink-0" style={{ background: page.background }} />
            <input
              value={bgName}
              onChange={(e) => onPageBackground(e.target.value)}
              className="flex-1 bg-transparent text-[12px] focus:outline-none"
            />
            <input
              type="color"
              value={normalizeHex(page.background)}
              onChange={(e) => onPageBackground(e.target.value)}
              className="w-5 h-5 bg-transparent border-none rounded cursor-pointer"
              aria-label="Pick color"
            />
          </div>
        </Section>

        <Section title="Typography">
          {/* Font family — wraps the selection in a span via inline style */}
          <select
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onInlineStyle(`font-family: ${v}`);
              e.target.selectedIndex = 0;
            }}
            className="w-full mb-2 bg-zinc-100 dark:bg-zinc-900 text-[12px] px-2 py-1.5 rounded border border-transparent focus:outline-none"
          >
            <option value="">Font…</option>
            {DOC_FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>

          {/* Font size — same trick (px values, not the 1-7 scale) */}
          <select
            onMouseDown={(e) => e.preventDefault()}
            onChange={(e) => {
              const v = e.target.value;
              if (v) onInlineStyle(`font-size: ${v}px`);
              e.target.selectedIndex = 0;
            }}
            className="w-full mb-2 bg-zinc-100 dark:bg-zinc-900 text-[12px] px-2 py-1.5 rounded border border-transparent focus:outline-none"
          >
            <option value="">Size…</option>
            {DOC_FONT_SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}
          </select>

          <div className="flex items-center gap-1 mb-2">
            <DocBtn {...md(() => onCommand('bold'))} title="Bold (⌘B)"><Bold size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('italic'))} title="Italic (⌘I)"><Italic size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('underline'))} title="Underline (⌘U)"><UnderlineIcon size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('strikeThrough'))} title="Strikethrough"><Strikethrough size={13} /></DocBtn>
            <DocBtn
              {...md(() => onCommand('removeFormat'))}
              title="Clear formatting"
            ><Eraser size={12} /></DocBtn>
          </div>

          <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">Text color</div>
          <div className="flex items-center gap-1 flex-wrap mb-2">
            {DOC_TEXT_COLORS.map((c) => (
              <button
                key={c}
                {...md(() => onCommand('foreColor', c))}
                title={c}
                style={{ background: c }}
                className="w-5 h-5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:scale-110 transition-transform"
              />
            ))}
          </div>

          <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">Highlight</div>
          <div className="flex items-center gap-1 flex-wrap">
            {DOC_HIGHLIGHTS.map((c) => (
              <button
                key={c}
                {...md(() => onCommand('hiliteColor', c === 'transparent' ? 'transparent' : c))}
                title={c}
                style={{
                  background: c === 'transparent' ? '#1f1f23' : c,
                  backgroundImage: c === 'transparent'
                    ? 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)'
                    : undefined,
                }}
                className="w-5 h-5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:scale-110 transition-transform"
              />
            ))}
          </div>
        </Section>

        <Section title="Paragraph">
          <div className="grid grid-cols-4 gap-1 mb-2">
            <DocBtn {...md(() => onCommand('justifyLeft'))} title="Align left"><AlignLeft size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('justifyCenter'))} title="Center"><AlignCenter size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('justifyRight'))} title="Align right"><AlignRight size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('justifyFull'))} title="Justify"><AlignJustify size={13} /></DocBtn>
          </div>
          <div className="grid grid-cols-2 gap-1 mb-2">
            <DocBtn {...md(() => onCommand('outdent'))} title="Decrease indent"><IndentDecrease size={13} /></DocBtn>
            <DocBtn {...md(() => onCommand('indent'))} title="Increase indent"><IndentIncrease size={13} /></DocBtn>
          </div>
          <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-1">Line height</div>
          <div className="grid grid-cols-4 gap-1">
            {DOC_LINE_HEIGHTS.map((h) => (
              <button
                key={h.value}
                {...md(() => onInlineStyle(`line-height: ${h.value}`))}
                className="px-2 py-1 text-[11px] rounded text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {h.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Outline">
          {headings.length === 0 ? (
            <p className="text-[11.5px] text-zinc-500">
              h1 / h2 / h3 を入れると、ここに目次が出ます。
            </p>
          ) : (
            <div className="space-y-0.5">
              {headings.map((h, i) => (
                <div
                  key={i}
                  className={`text-[12px] truncate text-zinc-700 dark:text-zinc-300 ${
                    h.level === 1 ? 'font-medium' : h.level === 2 ? 'pl-3 text-zinc-500 dark:text-zinc-400' : 'pl-6 text-zinc-500'
                  }`}
                >
                  {h.text}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// Tight square button used across the doc sidebar grids.
function DocBtn({
  children, title, onMouseDown,
}: {
  children: React.ReactNode;
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onMouseDown={onMouseDown}
      title={title}
      className="flex items-center justify-center h-7 rounded text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
    >
      {children}
    </button>
  );
}

// Pull h1/h2/h3 text out of a doc body for the outline panel. Cheap-and-
// cheerful regex parse — accurate enough for what we need (the body is
// always sanitized by being placed into a contenteditable surface).
function parseHeadings(body: string): { level: 1 | 2 | 3; text: string }[] {
  const out: { level: 1 | 2 | 3; text: string }[] = [];
  const re = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const level = Number(m[1].slice(1)) as 1 | 2 | 3;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (text) out.push({ level, text });
  }
  return out;
}

// Slide-mode inspector — Figma Slides parity. Header has Design/Animate
// tabs + a zoom dropdown; body has Slide N + layout icon, Template
// style, Background (segmented solid/gradient/image + color name),
// Selection colors. Layer-property edits live below when a layer is
// selected (Figma puts those in a separate Properties tab; we inline).
function DesignPanel({
  format, pageIndex, page, selectedItem, onUpdateItem, onPageBackground, zoom, onZoomChange,
}: {
  format: CraftFormat;
  pageIndex: number;
  page: { width: number; height: number; background: string };
  selectedItem: CanvasItem | null;
  onUpdateItem: (id: string, patch: Partial<CanvasItem>) => void;
  onPageBackground: (color: string) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}) {
  const bgName = colorName(page.background);
  const itemLabel = format === 'presentation' ? 'Slide' : 'Page';
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Design / Animate tabs + zoom — first row */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3 text-[13px]">
          <button className="font-semibold text-zinc-900 dark:text-white">Design</button>
          <button className="text-zinc-400 dark:text-zinc-500 cursor-not-allowed" disabled>Animate</button>
        </div>
        <ZoomMenu zoom={zoom} onZoomChange={onZoomChange} />
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Slide N + layout icon */}
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold text-zinc-900 dark:text-white">{itemLabel} {pageIndex + 1}</span>
          <button
            className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
            title="Slide layout (coming soon)"
          >
            <Sliders size={13} />
          </button>
        </div>

        <Section title="Template style" titleAction={
          <button className="p-0.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" title="Edit template">
            <Sliders size={11} />
          </button>
        }>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900">
            <div className="w-9 h-7 rounded-sm overflow-hidden flex shrink-0 border border-zinc-300 dark:border-zinc-700">
              <div className="flex-1 bg-white" />
              <div className="flex-1 bg-zinc-900" />
              <div className="flex-1 bg-[#1B4FA7]" />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] text-zinc-900 dark:text-white truncate">Light slides</div>
              <div className="text-[10.5px] text-zinc-500 truncate">Inter</div>
            </div>
          </div>
        </Section>

        <Section title="Background">
          {/* Segmented solid / gradient / image — only solid is wired up */}
          <div className="flex items-center gap-1 mb-2">
            <SegBtn active title="Solid"><FillSquare /></SegBtn>
            <SegBtn disabled title="Gradient (coming soon)"><GradientSquare /></SegBtn>
            <SegBtn disabled title="Image (coming soon)"><ImageIconLuc size={12} /></SegBtn>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900">
            <span className="w-4 h-4 rounded-sm border border-zinc-300 dark:border-zinc-700 shrink-0" style={{ background: page.background }} />
            <input
              value={bgName}
              onChange={(e) => onPageBackground(e.target.value)}
              className="flex-1 bg-transparent text-[12px] focus:outline-none"
            />
            <input
              type="color"
              value={normalizeHex(page.background)}
              onChange={(e) => onPageBackground(e.target.value)}
              className="w-5 h-5 bg-transparent border-none rounded cursor-pointer"
              aria-label="Pick color"
            />
          </div>
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => onPageBackground(c)}
                title={c}
                style={{ background: c }}
                className={`w-5 h-5 rounded-sm border ${page.background === c ? 'border-zinc-900 dark:border-white' : 'border-zinc-300 dark:border-zinc-700'}`}
              />
            ))}
          </div>
        </Section>

        <Section title="Selection colors">
          <div className="space-y-1">
            <ColorRow color="#000000" label="Black" />
            <ColorRow color="#ffffff" label="White" />
          </div>
        </Section>

        {/* Layer properties — appear when an item is selected. */}
        {selectedItem && (
          <Section title={`${selectedItem.type[0].toUpperCase()}${selectedItem.type.slice(1)} layer`}>
            <ItemProps item={selectedItem} onUpdate={(patch) => onUpdateItem(selectedItem.id, patch)} />
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title, children, titleAction,
}: {
  title: string;
  children: React.ReactNode;
  titleAction?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300">
        <span>{title}</span>
        {titleAction}
      </div>
      <div>{children}</div>
    </div>
  );
}

// Zoom dropdown for the slide canvas — matches Figma's "45% ▾" picker.
function ZoomMenu({ zoom, onZoomChange }: { zoom: number; onZoomChange: (z: number) => void }) {
  const presets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-0.5 px-1.5 h-6 text-[12px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
          <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
          <ChevronDown size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        {presets.map((z) => (
          <DropdownMenuItem key={z} onClick={() => onZoomChange(z)} className="text-[12px] tabular-nums gap-2">
            {Math.round(z * 100)}%
            {Math.abs(z - zoom) < 0.001 && <CheckCircle2 size={11} className="ml-auto text-emerald-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Tight square segmented button used by the Background section.
function SegBtn({
  active, disabled, title, children, onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'bg-white dark:bg-zinc-700 ring-1 ring-zinc-300 dark:ring-zinc-600 text-zinc-900 dark:text-white'
          : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

// Tiny SVGs used by the Background segmented control.
function FillSquare() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
      <rect x="1.5" y="1.5" width="11" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function GradientSquare() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="11" height="9" rx="1.5" fill="url(#g1)" />
    </svg>
  );
}

// Compact "swatch + name" row used by Selection colors.
function ColorRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-900">
      <span className="w-4 h-4 rounded-sm border border-zinc-300 dark:border-zinc-700" style={{ background: color }} />
      <span className="text-[12px]">{label}</span>
    </div>
  );
}

// Pretty name for common hex values (Figma shows "White", "Black"
// instead of the hex code in its color cells). Falls back to the hex.
// Two decorative icons used in the bottom toolbar (presenter / outline
// view toggles). Lucide doesn't quite have either so we draw them.
function PresenterIcon() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="11" height="7" rx="1" />
      <path d="M5 11 L9 11" />
      <path d="M7 8 L7 11" />
    </svg>
  );
}
function OutlineIcon() {
  return (
    <svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="3.5" height="9" rx="0.7" />
      <line x1="6.5" y1="3" x2="12.5" y2="3" />
      <line x1="6.5" y1="6" x2="12.5" y2="6" />
      <line x1="6.5" y1="9" x2="12.5" y2="9" />
    </svg>
  );
}

function colorName(hex: string): string {
  const c = (hex || '').toLowerCase();
  if (c === '#ffffff' || c === '#fff' || c === 'white') return 'White';
  if (c === '#000000' || c === '#000' || c === 'black') return 'Black';
  return hex;
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
                    (item as TextItem).fontSize === f.size ? 'bg-zinc-900 dark:bg-zinc-700 text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <button
                onClick={() => onUpdate({ fontWeight: (item as TextItem).fontWeight >= 600 ? 400 : 700 } as Partial<TextItem>)}
                className={`p-1.5 rounded ${
                  (item as TextItem).fontWeight >= 600 ? 'bg-zinc-900 dark:bg-zinc-700 text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
                    (item as TextItem).align === a ? 'bg-zinc-900 dark:bg-zinc-700 text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
                  (item as ImageItem).fit === f ? 'bg-zinc-900 dark:bg-zinc-700 text-white' : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
    <label className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 rounded px-2 py-1">
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
            className={`w-5 h-5 rounded-sm border ${current === c ? 'border-zinc-900 dark:border-white' : 'border-zinc-300 dark:border-zinc-700'}`}
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

// Pull the inner <body>...</body> contents from a full HTML doc; falls
// back to the original string if no body tag is present. Used for the
// AI assist path in Documentation mode.
function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!m) return html;
  return m[1].trim();
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
