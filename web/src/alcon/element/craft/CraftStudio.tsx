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
  RotateCcw, Loader2, Wand2, Trash2, Copy,
  MousePointer2, Type as TypeIcon, Square as SquareIcon,
  Image as ImageIconLuc, Bold, Italic, Strikethrough,
  Underline as UnderlineIcon, Eraser, MoreHorizontal,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  IndentDecrease, IndentIncrease,
  Sliders, ChevronDown,
  List, ListOrdered, Quote, Code2, Link2, Undo2, Redo2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/ui/dropdown-menu';
import { CraftCanvas, type CanvasTool, type CraftCanvasHandle } from './CraftCanvas';
import { DocEditor } from './DocEditor';
import {
  CraftDoc, emptyDoc, makeText, PAGE_SIZE,
  TextItem, RectItem, EllipseItem, ImageItem, CanvasItem,
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
  /** When true, render inline (filling the parent) instead of as a
   *  fixed-position modal with backdrop. Used by the top-level Compose
   *  view which already has its own MainContent slot. */
  embedded?: boolean;
}

const MODE: Record<CraftFormat, { label: string; icon: typeof FileText; accent: string }> = {
  documentation: {
    label: 'Doc',
    icon: FileText,
    accent: '#1B4FA7',
  },
  presentation: {
    label: 'Slide',
    icon: Presentation,
    accent: '#E2722C',
  },
};

const DEFAULT_DOC_HTML = '<h1>タイトルを入力</h1><p>本文を入力</p>';
type InsertKind =
  | 'text'
  | 'shape'
  | 'image'
  | 'video'
  | 'table'
  | 'divider'
  | 'emoji'
  | 'callout'
  | 'checklist'
  | 'toggle'
  | 'code'
  | 'quote'
  | 'formula';

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
    draftHtml: format === 'documentation' ? DEFAULT_DOC_HTML : null,
    updated_at: nowIso(),
  };
}

function ensureCanvas(session: CraftSession, format: CraftFormat): CraftSession {
  if (session.canvas && session.canvas.pages?.length) return session;
  return { ...session, canvas: emptyDoc(format) };
}

export function CraftStudio({ element, initialFormat = 'documentation', onClose, onCheckOut, embedded = false }: Props) {
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

  // Layer-order + clipboard helpers for the slide canvas. Also exposed
  // via keyboard shortcuts (Cmd/Ctrl+D duplicate, Del delete) handled
  // inside CraftCanvas, but we keep the semantics centralised so the
  // inspector can drive them too.
  const handleLayerAction = (action: 'front' | 'back' | 'forward' | 'backward' | 'duplicate' | 'delete') => {
    if (!selectedId) return;
    const page0 = session.canvas.pages[pageIndex];
    if (!page0) return;
    const items = [...page0.items];
    const idx = items.findIndex((it) => it.id === selectedId);
    if (idx === -1) return;
    const [item] = items.splice(idx, 1);

    let nextItems: CanvasItem[] = items;
    let nextSelected: string | null = selectedId;

    switch (action) {
      case 'front':    nextItems = [...items, item]; break;
      case 'forward':  nextItems = [...items.slice(0, idx + 1), item, ...items.slice(idx + 1)]; break;
      case 'backward': nextItems = [...items.slice(0, Math.max(0, idx - 1)), item, ...items.slice(Math.max(0, idx - 1))]; break;
      case 'back':     nextItems = [item, ...items]; break;
      case 'duplicate': {
        const copy: CanvasItem = {
          ...item,
          id: `${item.type[0]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          x: item.x + 16,
          y: item.y + 16,
        } as CanvasItem;
        nextItems = [...items, item, copy];
        nextSelected = copy.id;
        break;
      }
      case 'delete':
        nextItems = items;
        nextSelected = null;
        break;
    }

    handleCanvasChange({
      ...session.canvas,
      pages: session.canvas.pages.map((p, i) => (i === pageIndex ? { ...p, items: nextItems } : p)),
    });
    setSelectedId(nextSelected);
  };

  // File-menu trigger reused by both inspectors. Kept inline so it
  // stays in sync with the handlers above.
  const fileMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="File menu"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => setAiOpen(true)} className="gap-2 text-[12px]">
          <Wand2 size={12} /> AI assist
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDownload()} className="gap-2 text-[12px]">
          <Download size={12} /> Download HTML
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlePrintPdf()} className="gap-2 text-[12px]">
          <Printer size={12} /> Save as PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleReset()} className="gap-2 text-[12px] text-red-600">
          <RotateCcw size={12} /> Reset
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

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
  const docInsertHtml = (html: string) => {
    const el = docEditorRef.current;
    if (!el) return;
    el.focus();
    try { document.execCommand('insertHTML', false, html); } catch { /* ignore */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const mode = MODE[format];

  useEffect(() => {
    // Skip the body-overflow lock in embedded mode — the studio fills
    // its own pane, not the entire viewport.
    if (embedded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [embedded]);

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

  const updateSelectedText = (patch: Partial<TextItem>) => {
    if (!selectedItem || selectedItem.type !== 'text') {
      setTool('text');
      return;
    }
    updateItem(selectedItem.id, patch);
  };

  const applyTextPreset = (preset: 'title' | 'h1' | 'h2' | 'body') => {
    if (isDoc) {
      const block = preset === 'title' || preset === 'h1'
        ? 'H1'
        : preset === 'h2'
          ? 'H2'
          : 'P';
      docCmd('formatBlock', block);
      return;
    }
    const patch: Partial<TextItem> =
      preset === 'title'
        ? { fontSize: 54, fontWeight: 700 }
        : preset === 'h1'
          ? { fontSize: 40, fontWeight: 700 }
          : preset === 'h2'
            ? { fontSize: 30, fontWeight: 600 }
            : { fontSize: 22, fontWeight: 400 };
    updateSelectedText(patch);
  };

  const applyFontFamily = (fontFamily: string) => {
    if (!fontFamily) return;
    if (isDoc) docInlineStyle(`font-family: ${fontFamily}`);
    else updateSelectedText({ fontFamily });
  };

  const applyFontSize = (fontSize: number) => {
    if (!Number.isFinite(fontSize)) return;
    if (isDoc) docInlineStyle(`font-size: ${fontSize}px`);
    else updateSelectedText({ fontSize });
  };

  const toggleBold = () => {
    if (isDoc) {
      docCmd('bold');
      return;
    }
    if (selectedItem?.type === 'text') {
      updateSelectedText({ fontWeight: selectedItem.fontWeight >= 600 ? 400 : 700 });
    } else {
      setTool('text');
    }
  };

  const toggleItalic = () => {
    if (isDoc) {
      docCmd('italic');
      return;
    }
    if (selectedItem?.type === 'text') {
      updateSelectedText({ fontStyle: selectedItem.fontStyle === 'italic' ? 'normal' : 'italic' });
    } else {
      setTool('text');
    }
  };

  const toggleDecoration = (decoration: 'underline' | 'line-through') => {
    if (isDoc) {
      docCmd(decoration === 'underline' ? 'underline' : 'strikeThrough');
      return;
    }
    if (selectedItem?.type === 'text') {
      updateSelectedText({
        textDecoration: selectedItem.textDecoration === decoration ? 'none' : decoration,
      });
    } else {
      setTool('text');
    }
  };

  const insertImage = () => {
    if (isDoc) {
      const url = prompt('画像 URL (https: または data:)');
      if (url) docCmd('insertImage', url);
      return;
    }
    setTool('image');
  };

  const insertLink = () => {
    if (!isDoc) return;
    const url = prompt('リンク URL を入力');
    if (url) docCmd('createLink', url);
  };

  const addCanvasText = (text = 'テキストを入力') => {
    const page = session.canvas.pages[pageIndex] ?? session.canvas.pages[0];
    const item = makeText(80, 80, format);
    item.text = text;
    item.w = Math.min(560, page.width - 160);
    handleCanvasChange({
      ...session.canvas,
      pages: session.canvas.pages.map((p, i) =>
        i === pageIndex ? { ...p, items: [...p.items, item] } : p
      ),
    });
    setSelectedId(item.id);
    setTool('select');
  };

  const addCanvasDivider = () => {
    const page = session.canvas.pages[pageIndex] ?? session.canvas.pages[0];
    const divider: RectItem = {
      id: newId('r'),
      type: 'rect',
      x: 80,
      y: 220,
      w: Math.max(240, page.width - 160),
      h: 3,
      fill: '#d4d4d8',
      stroke: 'transparent',
      strokeWidth: 0,
      radius: 2,
    };
    handleCanvasChange({
      ...session.canvas,
      pages: session.canvas.pages.map((p, i) =>
        i === pageIndex ? { ...p, items: [...p.items, divider] } : p
      ),
    });
    setSelectedId(divider.id);
    setTool('select');
  };

  const insertBlock = (kind: InsertKind) => {
    if (!isDoc) {
      if (kind === 'text') addCanvasText();
      else if (kind === 'shape') setTool('rect');
      else if (kind === 'image') insertImage();
      else if (kind === 'divider') addCanvasDivider();
      else if (kind === 'emoji') addCanvasText('😊');
      else if (kind === 'table') addCanvasText('項目\\t内容\\n項目\\t内容');
      else addCanvasText(kind);
      return;
    }

    switch (kind) {
      case 'text':
        docInsertHtml('<p>本文を入力</p>');
        break;
      case 'shape':
        docInsertHtml('<div style="width:160px;height:80px;border-radius:8px;background:#1B4FA7;margin:12px 0;"></div>');
        break;
      case 'image':
        insertImage();
        break;
      case 'table':
        docInsertHtml('<table><tbody><tr><th>項目</th><th>内容</th></tr><tr><td>項目</td><td>内容</td></tr><tr><td>項目</td><td>内容</td></tr></tbody></table><p></p>');
        break;
      case 'divider':
        docInsertHtml('<hr style="border:0;border-top:1px solid #d4d4d8;margin:24px 0;" /><p></p>');
        break;
      case 'emoji':
        docInsertHtml('😊');
        break;
      case 'video': {
        const url = prompt('動画 URL を入力');
        if (url) {
          docInsertHtml(`<p><a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">動画: ${escapeHtmlText(url)}</a></p>`);
        }
        break;
      }
      case 'callout':
        docInsertHtml('<blockquote style="border-left:4px solid #1B4FA7;background:#eff6ff;padding:12px 14px;border-radius:6px;margin:12px 0;">重要なメモを入力</blockquote><p></p>');
        break;
      case 'checklist':
        docInsertHtml('<ul><li>☐ タスクを入力</li><li>☐ タスクを入力</li></ul><p></p>');
        break;
      case 'toggle':
        docInsertHtml('<details style="margin:12px 0;"><summary>トグル見出し</summary><p>内容を入力</p></details><p></p>');
        break;
      case 'code':
        docCmd('formatBlock', 'PRE');
        break;
      case 'quote':
        docCmd('formatBlock', 'BLOCKQUOTE');
        break;
      case 'formula':
        docInsertHtml('<p><code>Σ 数式を入力</code></p>');
        break;
    }
  };

  const applyTextColor = (color: string) => {
    if (isDoc) docCmd('foreColor', color);
    else updateSelectedText({ color });
  };

  const applyHighlight = (color: string) => {
    if (isDoc) docCmd('hiliteColor', color);
    else updateSelectedText({ backgroundColor: color });
  };

  const applyAlign = (align: 'left' | 'center' | 'right' | 'justify') => {
    if (isDoc) {
      const command = align === 'left'
        ? 'justifyLeft'
        : align === 'center'
          ? 'justifyCenter'
          : align === 'right'
            ? 'justifyRight'
            : 'justifyFull';
      docCmd(command);
      return;
    }
    if (selectedItem?.type === 'text' && align !== 'justify') {
      updateSelectedText({ align });
      return;
    }
    if (selectedItem && align !== 'justify') {
      const page = session.canvas.pages[pageIndex] ?? session.canvas.pages[0];
      const nextX = align === 'left'
        ? 0
        : align === 'center'
          ? Math.round((page.width - selectedItem.w) / 2)
          : Math.max(0, page.width - selectedItem.w);
      updateItem(selectedItem.id, { x: nextX });
    }
  };

  const applyLineHeight = (lineHeight: number) => {
    if (isDoc) docInlineStyle(`line-height: ${lineHeight}`);
    else updateSelectedText({ lineHeight });
  };

  const applyIndent = (direction: 'in' | 'out') => {
    if (isDoc) docCmd(direction === 'in' ? 'indent' : 'outdent');
    else if (selectedItem) updateItem(selectedItem.id, { x: selectedItem.x + (direction === 'in' ? 24 : -24) });
  };

  const clearFormatting = () => {
    if (isDoc) {
      docCmd('removeFormat');
      return;
    }
    if (selectedItem?.type === 'text') {
      updateSelectedText({
        fontWeight: 400,
        fontStyle: 'normal',
        textDecoration: 'none',
        lineHeight: 1.4,
        color: '#111111',
        backgroundColor: 'transparent',
      });
    }
  };

  return (
    <div
      className={embedded
        ? 'relative w-full h-full bg-white dark:bg-[#1e1e1e] text-zinc-900 dark:text-zinc-200 overflow-hidden'
        : 'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3'
      }
    >
      <div
        className={embedded
          ? 'relative w-full h-full bg-white dark:bg-[#1e1e1e] text-zinc-900 dark:text-zinc-200 overflow-hidden'
          : 'relative w-full h-full max-w-[1500px] max-h-[920px] bg-white dark:bg-[#1e1e1e] text-zinc-900 dark:text-zinc-200 rounded-lg shadow-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800'
        }
      >

        {/* ── Center: editor / canvas (full bleed, behind islands) ───── */}
        <div className="absolute inset-0">
          {isDoc ? (
            <DocEditor
              html={session.draftHtml ?? ''}
              onChange={handleDocHtmlChange}
              editorRef={docEditorRef}
            />
          ) : (
            <CraftCanvas
              ref={canvasRef}
              doc={session.canvas}
              pageIndex={pageIndex}
              onPageIndexChange={setPageIndex}
              onChange={handleCanvasChange}
              tool={tool}
              onToolChange={setTool}
              selectedId={selectedId}
              onSelect={setSelectedId}
              zoom={zoom}
              onZoomChange={setZoom}
            />
          )}
        </div>

        <CraftTopToolbar
          isDoc={isDoc}
          title={session.title}
          onTitleChange={(t) => setSession({ ...session, title: t, updated_at: nowIso() })}
          selectedItem={selectedItem}
          activeTool={tool}
          accent={mode.accent}
          zoom={zoom}
          onZoomChange={setZoom}
          onSelectTool={() => setTool('select')}
          onTextTool={() => setTool('text')}
          onShapeTool={() => setTool('rect')}
          onImage={insertImage}
          onInsert={insertBlock}
          onPreset={applyTextPreset}
          onFontFamily={applyFontFamily}
          onFontSize={applyFontSize}
          onTextColor={applyTextColor}
          onHighlight={applyHighlight}
          onBold={toggleBold}
          onItalic={toggleItalic}
          onUnderline={() => toggleDecoration('underline')}
          onStrike={() => toggleDecoration('line-through')}
          onAlign={applyAlign}
          onLineHeight={applyLineHeight}
          onIndent={applyIndent}
          onClearFormatting={clearFormatting}
          onBullets={() => isDoc && docCmd('insertUnorderedList')}
          onNumbered={() => isDoc && docCmd('insertOrderedList')}
          onQuote={() => isDoc && docCmd('formatBlock', 'BLOCKQUOTE')}
          onCode={() => isDoc && docCmd('formatBlock', 'PRE')}
          onLink={insertLink}
          onUndo={() => isDoc && docCmd('undo')}
          onRedo={() => isDoc && docCmd('redo')}
        />

        {/* ── Top-left compact context chip. The page thumbnail rail is
            intentionally hidden for now so the canvas feels closer to
            Figma's focused editing surface. */}
        <FloatChip className="absolute top-3 left-3 z-20 h-9 gap-2 px-2.5">
          <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100">
            {isDoc ? 'Documentation' : 'Presentation'}
          </span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            title="Close (auto-saved)"
          >
            <X size={14} />
          </button>
        </FloatChip>

        {/* ── Format toggle + Check out — both float just above the right
            inspector, so the two control surfaces (Slide / Doc switch
            and the Check-out CTA) live in the same vertical column as
            the inspector they belong to. */}
        <FloatChip className="absolute top-3 right-3 z-20">
          {(Object.keys(MODE) as CraftFormat[]).map((f) => {
            const t = MODE[f];
            const Icon = t.icon;
            const active = f === format;
            return (
              <button
                key={f}
                onClick={() => setFormat(f)}
                title={t.label}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                  active
                    ? 'text-white'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
                style={active ? { background: t.accent } : undefined}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </FloatChip>
        <button
          onClick={handleCheckOut}
          className="absolute top-3 right-[100px] z-20 flex items-center gap-1.5 px-3 h-9 text-[12px] font-medium text-white rounded-lg shadow-md transition-colors"
          style={{ background: '#F24E1E' }}
          title="Check out — attach to Element + bump status to review"
        >
          <CheckCircle2 size={12} /> Check out
        </button>

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

function CraftTopToolbar({
  isDoc,
  title,
  onTitleChange,
  selectedItem,
  activeTool,
  accent,
  zoom,
  onZoomChange,
  onSelectTool,
  onTextTool,
  onShapeTool,
  onImage,
  onInsert,
  onPreset,
  onFontFamily,
  onFontSize,
  onTextColor,
  onHighlight,
  onBold,
  onItalic,
  onUnderline,
  onStrike,
  onAlign,
  onLineHeight,
  onIndent,
  onClearFormatting,
  onBullets,
  onNumbered,
  onQuote,
  onCode,
  onLink,
  onUndo,
  onRedo,
}: {
  isDoc: boolean;
  title: string;
  onTitleChange: (title: string) => void;
  selectedItem: CanvasItem | null;
  activeTool: CanvasTool;
  accent: string;
  zoom: number;
  onZoomChange: (z: number) => void;
  onSelectTool: () => void;
  onTextTool: () => void;
  onShapeTool: () => void;
  onImage: () => void;
  onInsert: (kind: InsertKind) => void;
  onPreset: (preset: 'title' | 'h1' | 'h2' | 'body') => void;
  onFontFamily: (fontFamily: string) => void;
  onFontSize: (fontSize: number) => void;
  onTextColor: (color: string) => void;
  onHighlight: (color: string) => void;
  onBold: () => void;
  onItalic: () => void;
  onUnderline: () => void;
  onStrike: () => void;
  onAlign: (align: 'left' | 'center' | 'right' | 'justify') => void;
  onLineHeight: (lineHeight: number) => void;
  onIndent: (direction: 'in' | 'out') => void;
  onClearFormatting: () => void;
  onBullets: () => void;
  onNumbered: () => void;
  onQuote: () => void;
  onCode: () => void;
  onLink: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const selectedText = selectedItem?.type === 'text' ? selectedItem : null;
  const keepSelection = (run: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    run();
  };
  const insertItems: { kind: InsertKind; icon: string; label: string }[] = [
    { kind: 'text', icon: 'T', label: 'Text box' },
    { kind: 'shape', icon: '□', label: 'Shape' },
    { kind: 'image', icon: '▧', label: 'Image' },
    { kind: 'video', icon: '▶', label: 'Video embed' },
    { kind: 'table', icon: '⊞', label: 'Table' },
    { kind: 'divider', icon: '─', label: 'Divider' },
    { kind: 'emoji', icon: '☺', label: 'Emoji / icon' },
    { kind: 'callout', icon: '!', label: 'Callout' },
    { kind: 'checklist', icon: '☑', label: 'Checklist' },
    { kind: 'toggle', icon: '▸', label: 'Toggle' },
    { kind: 'code', icon: '</>', label: 'Code' },
    { kind: 'quote', icon: '"', label: 'Quote' },
    { kind: 'formula', icon: 'Σ', label: 'Formula' },
  ];

  return (
    <div className="absolute left-[160px] right-[210px] top-3 z-20 flex flex-col gap-1 px-2 py-2 min-h-[76px] bg-white/95 dark:bg-[#262629]/95 backdrop-blur border border-zinc-200/80 dark:border-zinc-700/80 rounded-xl shadow-xl text-zinc-700 dark:text-zinc-200">
      <div className="flex w-full items-center gap-1 overflow-x-auto">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          title="Document title"
          className="w-28 h-7 px-2 rounded-md bg-zinc-100 dark:bg-zinc-900 text-[12px] font-medium outline-none focus:ring-1 focus:ring-zinc-300 dark:focus:ring-zinc-600 shrink-0"
        />
        <ToolbarDivider />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onMouseDown={(e) => e.preventDefault()}
              className="h-7 px-2 rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[12px] flex items-center gap-1.5 shrink-0"
              title="Insert"
            >
              Insert <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {insertItems.map((item, index) => (
              <div key={item.kind}>
                {index === 4 || index === 7 || index === 10 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={() => onInsert(item.kind)} className="gap-2 text-[12px]">
                  <span className="w-5 text-center text-[12px] text-zinc-500 dark:text-zinc-400">{item.icon}</span>
                  {item.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {!isDoc && (
          <ToolbarButton active={activeTool === 'select'} onMouseDown={keepSelection(onSelectTool)} title="Select">
            <MousePointer2 size={13} />
          </ToolbarButton>
        )}
        <ToolbarButton active={activeTool === 'text'} onMouseDown={keepSelection(onTextTool)} title="Text box">
          <TypeIcon size={13} />
        </ToolbarButton>
        <ToolbarButton active={!isDoc && activeTool === 'rect'} onMouseDown={keepSelection(onShapeTool)} title="Shape">
          <SquareIcon size={13} />
        </ToolbarButton>
        <ToolbarButton onMouseDown={keepSelection(onImage)} title="Image">
          <ImageIconLuc size={13} />
        </ToolbarButton>
        <ToolbarDivider />
        <select
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => {
            onPreset(e.target.value as 'title' | 'h1' | 'h2' | 'body');
            e.currentTarget.selectedIndex = 0;
          }}
          className="h-7 w-24 rounded-md bg-zinc-100 dark:bg-zinc-900 px-2 text-[12px] outline-none shrink-0"
          title="Title / heading"
        >
          <option value="">Style</option>
          <option value="title">Title</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="body">Body</option>
        </select>
        <select
          value={selectedText?.fontFamily ?? ''}
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => onFontFamily(e.target.value)}
          className="h-7 w-28 rounded-md bg-zinc-100 dark:bg-zinc-900 px-2 text-[12px] outline-none shrink-0"
          title="Font"
        >
          <option value="">Font</option>
          {DOC_FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select
          value={selectedText?.fontSize ?? ''}
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => onFontSize(Number(e.target.value))}
          className="h-7 w-16 rounded-md bg-zinc-100 dark:bg-zinc-900 px-2 text-[12px] outline-none shrink-0"
          title="Size"
        >
          <option value="">Size</option>
          {DOC_FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {!isDoc && <ZoomMenu zoom={zoom} onZoomChange={onZoomChange} />}
        <div className="ml-auto w-1 h-7 rounded-full shrink-0" style={{ background: accent }} />
      </div>
      <div className="h-px bg-zinc-200/70 dark:bg-zinc-700/70" />
      <div className="flex w-full items-center gap-1 overflow-x-auto">
      <ToolbarButton active={selectedText?.fontWeight ? selectedText.fontWeight >= 600 : false} onMouseDown={keepSelection(onBold)} title="Bold">
        <Bold size={13} />
      </ToolbarButton>
      <ToolbarButton active={selectedText?.fontStyle === 'italic'} onMouseDown={keepSelection(onItalic)} title="Italic">
        <Italic size={13} />
      </ToolbarButton>
      <ToolbarButton active={selectedText?.textDecoration === 'underline'} onMouseDown={keepSelection(onUnderline)} title="Underline">
        <UnderlineIcon size={13} />
      </ToolbarButton>
      <ToolbarButton active={selectedText?.textDecoration === 'line-through'} onMouseDown={keepSelection(onStrike)} title="Strikethrough">
        <Strikethrough size={13} />
      </ToolbarButton>
      <ToolbarButton onMouseDown={keepSelection(onClearFormatting)} title="Clear formatting">
        <Eraser size={13} />
      </ToolbarButton>
      <ToolbarDivider />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onMouseDown={(e) => e.preventDefault()}
            className="h-7 px-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[12px] flex items-center gap-1.5 shrink-0"
            title="Text color"
          >
            <span className="font-semibold">A</span>
            <span
              className="w-3 h-0.5 rounded-full"
              style={{ background: selectedText?.color ?? '#111111' }}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <div className="grid grid-cols-6 gap-1 p-2">
            {DOC_TEXT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onTextColor(c)}
                className="w-5 h-5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:scale-110 transition-transform"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onMouseDown={(e) => e.preventDefault()}
            className="h-7 px-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[12px] flex items-center gap-1.5 shrink-0"
            title="Highlight"
          >
            <span className="font-semibold">H</span>
            <span
              className="w-3 h-0.5 rounded-full"
              style={{ background: selectedText?.backgroundColor ?? '#fef3c7' }}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <div className="grid grid-cols-6 gap-1 p-2">
            {DOC_HIGHLIGHTS.map((c) => (
              <button
                key={c}
                onClick={() => onHighlight(c)}
                className="w-5 h-5 rounded-sm border border-zinc-300 dark:border-zinc-700 hover:scale-110 transition-transform"
                style={{
                  background: c === 'transparent' ? '#1f1f23' : c,
                  backgroundImage: c === 'transparent'
                    ? 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)'
                    : undefined,
                }}
                title={c === 'transparent' ? 'No highlight' : c}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarDivider />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onMouseDown={(e) => e.preventDefault()}
            className="h-7 px-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[12px] flex items-center gap-1.5 shrink-0"
            title="Alignment"
          >
            <AlignLeft size={13} />
            <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuItem onClick={() => onAlign('left')} className="gap-2 text-[12px]"><AlignLeft size={13} /> Left</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAlign('center')} className="gap-2 text-[12px]"><AlignCenter size={13} /> Center</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAlign('right')} className="gap-2 text-[12px]"><AlignRight size={13} /> Right</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAlign('justify')} className="gap-2 text-[12px]"><AlignJustify size={13} /> Justify</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onMouseDown={(e) => e.preventDefault()}
            className="h-7 px-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[12px] flex items-center gap-1.5 shrink-0"
            title="Line height"
          >
            ↕ <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-28">
          {DOC_LINE_HEIGHTS.map((h) => (
            <DropdownMenuItem key={h.value} onClick={() => onLineHeight(Number(h.value))} className="text-[12px]">
              {h.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarButton onMouseDown={keepSelection(() => onIndent('out'))} title="Decrease indent">
        <IndentDecrease size={13} />
      </ToolbarButton>
      <ToolbarButton onMouseDown={keepSelection(() => onIndent('in'))} title="Increase indent">
        <IndentIncrease size={13} />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onBullets)} title="Bulleted list">
        <List size={13} />
      </ToolbarButton>
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onNumbered)} title="Numbered list">
        <ListOrdered size={13} />
      </ToolbarButton>
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onQuote)} title="Quote">
        <Quote size={13} />
      </ToolbarButton>
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onCode)} title="Code block">
        <Code2 size={13} />
      </ToolbarButton>
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onLink)} title="Link">
        <Link2 size={13} />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onUndo)} title="Undo">
        <Undo2 size={13} />
      </ToolbarButton>
      <ToolbarButton disabled={!isDoc} onMouseDown={keepSelection(onRedo)} title="Redo">
        <Redo2 size={13} />
      </ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarButton({
  active,
  disabled,
  title,
  children,
  onMouseDown,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onMouseDown={onMouseDown}
      disabled={disabled}
      title={title}
      className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />;
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
  title, onTitleChange, bodyHtml, onCommand, onInlineStyle,
  page, pageIndex, onPageBackground, fileActions,
}: {
  title: string;
  onTitleChange: (t: string) => void;
  bodyHtml: string;
  onCommand: (command: string, value?: string) => void;
  onInlineStyle: (cssText: string) => void;
  page: { width: number; height: number; background: string };
  pageIndex: number;
  onPageBackground: (color: string) => void;
  fileActions?: React.ReactNode;
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
        {fileActions}
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

          <div className="text-[10.5px] text-zinc-500 mb-1">Text color</div>
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

          <div className="text-[10.5px] text-zinc-500 mb-1">Highlight</div>
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
          <div className="text-[10.5px] text-zinc-500 mb-1">Line height</div>
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
  format, pageIndex, page, selectedItem, onUpdateItem, onPageBackground,
  onLayerAction, zoom, onZoomChange, fileActions,
}: {
  format: CraftFormat;
  pageIndex: number;
  page: { width: number; height: number; background: string };
  selectedItem: CanvasItem | null;
  onUpdateItem: (id: string, patch: Partial<CanvasItem>) => void;
  onPageBackground: (color: string) => void;
  onLayerAction: (action: 'front' | 'back' | 'forward' | 'backward' | 'duplicate' | 'delete') => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  fileActions?: React.ReactNode;
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
        <div className="flex items-center gap-1">
          <ZoomMenu zoom={zoom} onZoomChange={onZoomChange} />
          {fileActions}
        </div>
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
            <div className="grid grid-cols-4 gap-1 mt-3">
              <SegBtn title="Bring to front" onClick={() => onLayerAction('front')}><BringFrontIcon /></SegBtn>
              <SegBtn title="Bring forward" onClick={() => onLayerAction('forward')}><BringForwardIcon /></SegBtn>
              <SegBtn title="Send backward" onClick={() => onLayerAction('backward')}><SendBackwardIcon /></SegBtn>
              <SegBtn title="Send to back" onClick={() => onLayerAction('back')}><SendBackIcon /></SegBtn>
            </div>
            <div className="grid grid-cols-2 gap-1 mt-1">
              <SegBtn title="Duplicate (⌘D)" onClick={() => onLayerAction('duplicate')}><Copy size={12} /></SegBtn>
              <SegBtn title="Delete (Del)" onClick={() => onLayerAction('delete')}><Trash2 size={12} /></SegBtn>
            </div>
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
// Floating "chip" — small horizontal capsule with rounded shadow. Used
// for the top-corner action clusters and the format toggle.
function FloatChip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1 p-1 rounded-lg bg-white/95 dark:bg-[#262629]/95 backdrop-blur border border-zinc-200/80 dark:border-zinc-700/80 shadow-md ${className}`}>
      {children}
    </div>
  );
}

// Floating "island" — larger card used for the left thumbnails rail and
// the right inspector panel. Pushed off the dotted canvas bg with a
// distinct fill + a slightly brighter border, so the panels read as
// detached cards rather than blending into the background.
function FloatIsland({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <aside className={`bg-white dark:bg-[#26262a] border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl overflow-hidden ${className}`}>
      {children}
    </aside>
  );
}

// Layer-order icons for the inspector quick-actions row.
function BringFrontIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
    </svg>
  );
}
function BringForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
      <rect x="1" y="1" width="6" height="6" rx="1" />
    </svg>
  );
}
function SendBackwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}
function SendBackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="7" width="6" height="6" rx="1" />
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
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

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtmlText(text).replace(/"/g, '&quot;');
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
