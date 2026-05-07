'use client';

// CraftStudio — the big popup. A Figma-style dotted canvas with a
// centered page (A4 for Documentation, 16:9 for Presentation). Manual
// editing is the primary mode: pick a tool, click on the page, drag to
// move/resize. AI assist is available as a small "Generate first draft"
// action on an empty canvas — it calls the existing generate-craft Edge
// Function and stamps the rendered HTML as a single full-page image-ish
// block the user can then chop up.

import { useEffect, useMemo, useState } from 'react';
import {
  X, Sparkles, FileText, Presentation, Download, Printer, CheckCircle2,
  RotateCcw, Loader2, Wand2,
} from 'lucide-react';
import { CraftCanvas } from './CraftCanvas';
import {
  CraftDoc, emptyDoc, makeText, PAGE_SIZE,
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

const MODE_THEME: Record<CraftFormat, { label: string; icon: typeof FileText; band: string; tab: string }> = {
  documentation: {
    label: 'Documentation',
    icon: FileText,
    band: 'bg-gradient-to-r from-[#0F2A52] to-[#1B4FA7]',
    tab: 'data-[active=true]:bg-[#1B4FA7] data-[active=true]:text-white data-[active=true]:border-[#1B4FA7]',
  },
  presentation: {
    label: 'Presentation',
    icon: Presentation,
    band: 'bg-gradient-to-r from-[#B7410E] to-[#E2722C]',
    tab: 'data-[active=true]:bg-[#B7410E] data-[active=true]:text-white data-[active=true]:border-[#B7410E]',
  },
};

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

// Older sessions only had `draftHtml`. Wrap them so the studio still loads.
function ensureCanvas(session: CraftSession, format: CraftFormat): CraftSession {
  if (session.canvas && session.canvas.pages?.length) return session;
  return { ...session, canvas: emptyDoc(format) };
}

export function CraftStudio({ element, initialFormat = 'documentation', onClose, onCheckOut }: Props) {
  const [format, setFormat] = useState<CraftFormat>(initialFormat);
  const [session, setSession] = useState<CraftSession>(() => {
    const stored = loadSession(element.id, initialFormat);
    if (stored) return ensureCanvas(stored, initialFormat);
    return emptySession(element.id, `${element.title} — ${MODE_THEME[initialFormat].label}`, initialFormat);
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');

  const theme = MODE_THEME[format];

  // Lock scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Switch format → load (or create) the corresponding session, resize page.
  useEffect(() => {
    const stored = loadSession(element.id, format);
    const next = stored
      ? ensureCanvas(stored, format)
      : emptySession(element.id, `${element.title} — ${MODE_THEME[format].label}`, format);
    // If the canvas was created in a different format, swap the page size.
    if (next.canvas.format !== format) {
      const size = PAGE_SIZE[format];
      next.canvas = {
        format,
        pages: next.canvas.pages.map((p) => ({ ...p, width: size.width, height: size.height })),
      };
    }
    setSession(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, element.id]);

  // Persist on every change.
  useEffect(() => { saveSession(session); }, [session]);

  const renderedHtml = useMemo(() => renderDocToHtml(session.canvas), [session.canvas]);

  const handleCanvasChange = (canvas: CraftDoc) => {
    setSession((s) => ({ ...s, canvas, draftHtml: null, updated_at: nowIso() }));
  };

  const handleReset = () => {
    if (!confirm('現在のキャンバスを破棄します。よろしいですか?')) return;
    setSession(emptySession(element.id, `${element.title} — ${theme.label}`, format));
  };

  const handleDownload = () => {
    const blob = new Blob([renderedHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.html`;
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
      title: session.title || `${element.title} — ${theme.label}`,
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

  // AI assist: takes a prompt, asks the Edge Function for a draft, drops
  // the resulting body content into the canvas as a single text item the
  // user can then break up. Pragmatic stopgap until we ship a proper
  // HTML-to-canvas-items adapter.
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
          const page0 = s.canvas.pages[0];
          const item = makeText(60, 60, format);
          item.text = text;
          item.w = page0.width - 120;
          item.h = page0.height - 120;
          item.fontSize = format === 'presentation' ? 24 : 14;
          return {
            ...s,
            canvas: { ...s.canvas, pages: [{ ...page0, items: [...page0.items, item] }] },
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
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      {/* Big popup */}
      <div className="w-full h-full max-w-[1500px] max-h-[920px] bg-white dark:bg-zinc-950 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className={`h-2.5 ${theme.band}`} />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={15} className="text-amber-500 shrink-0" />
            <input
              value={session.title}
              onChange={(e) => setSession({ ...session, title: e.target.value, updated_at: nowIso() })}
              className="text-[14px] font-medium bg-transparent border-none focus:outline-none w-72 truncate"
            />
          </div>
          <div className="flex items-center gap-1">
            {(Object.keys(MODE_THEME) as CraftFormat[]).map((f) => {
              const t = MODE_THEME[f];
              const Icon = t.icon;
              return (
                <button
                  key={f}
                  data-active={f === format}
                  onClick={() => setFormat(f)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded border-b-2 border-transparent text-zinc-600 hover:text-zinc-900 transition-colors ${t.tab}`}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1">
            <HeaderBtn onClick={() => setAiOpen(true)} title="Ask AI to draft (optional)">
              <Wand2 size={13} /> AI
            </HeaderBtn>
            <HeaderBtn onClick={handleReset} title="Reset canvas">
              <RotateCcw size={13} /> Reset
            </HeaderBtn>
            <HeaderBtn onClick={handleDownload} title="Download HTML">
              <Download size={13} /> HTML
            </HeaderBtn>
            <HeaderBtn onClick={handlePrintPdf} title="Save as PDF (browser print)">
              <Printer size={13} /> PDF
            </HeaderBtn>
            <button
              onClick={handleCheckOut}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors ml-1"
            >
              <CheckCircle2 size={13} /> Check out
            </button>
            <button
              onClick={onClose}
              className="p-1.5 ml-1 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
              title="Close (canvas auto-saved)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body — canvas */}
        <CraftCanvas doc={session.canvas} onChange={handleCanvasChange} />

        {/* AI prompt — modal-in-modal */}
        {aiOpen && (
          <div className="absolute inset-0 z-30 bg-black/30 flex items-center justify-center" onClick={() => setAiOpen(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[480px] bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Wand2 size={14} className="text-amber-500" />
                <span className="text-[13px] font-medium">AI に下書きを作らせる</span>
              </div>
              <p className="text-[11.5px] text-zinc-500">
                生成された本文がキャンバス上に 1 つのテキストブロックとして配置されます。
                その後ドラッグ / 編集 / 分割は手動でどうぞ。
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例: 5 枚構成のピッチデッキを作って"
                rows={3}
                className="w-full text-[13px] bg-zinc-50 dark:bg-zinc-800 rounded px-2.5 py-2 resize-none border border-transparent focus:outline-none"
              />
              {aiError && <div className="text-[12px] text-red-500">{aiError}</div>}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setAiOpen(false)} className="px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded">
                  Cancel
                </button>
                <button
                  onClick={handleAiGenerate}
                  disabled={!aiPrompt.trim() || aiBusy}
                  className="px-3 py-1.5 text-[12px] font-medium text-white bg-zinc-900 hover:opacity-90 rounded disabled:opacity-40 flex items-center gap-1.5"
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

function HeaderBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
    >
      {children}
    </button>
  );
}

function stripHtml(html: string): string {
  // Quick text extractor — drops tags, decodes a few entities. Good
  // enough for staging an AI draft on the canvas for the user to refine.
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
