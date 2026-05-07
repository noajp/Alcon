'use client';

// Fullscreen workspace — chat composer paired with a sandboxed iframe
// preview, plus a manual editing surface (open-pencil inspired) so a human
// can type/format directly into the deliverable instead of round-tripping
// every change through chat.
//
// Two output modes selectable via top tabs:
//   Documentation — long-form one-pager. Navy band identifies the mode.
//   Presentation  — slide deck. Dark orange band identifies the mode.
// The active mode determines: system prompt, default templates, header
// band color, and the band text injected into the manual edit toolbar.
//
// "Check out" returns the (final) HTML to the parent, which attaches it to
// the Element and bumps the status to review.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Send, Sparkles, X, Download, CheckCircle2, RotateCcw, Eye,
  Square, Code2, Smartphone, Tablet, Monitor, Hash, Printer, Files,
  MessageSquarePlus, Pin, Trash2, Pencil, FileText, Presentation,
} from 'lucide-react';
import { generateCraft } from './generateCraft';
import {
  loadSession,
  saveSession,
  clearSession,
} from './craftStore';
import { templatesFor } from './templates';
import { splitHtml } from './htmlSplit';
import { buildPinnedPrompt, withBridge, type CommentPin } from './commentBridge';
import { ManualEditor } from './ManualEditor';
import type { Craft, CraftFormat, CraftMessage, CraftSession } from './types';

interface Props {
  element: { id: string; title: string; description?: string | null };
  /** Initial mode the workspace should open in. Defaults to documentation. */
  initialFormat?: CraftFormat;
  onClose: () => void;
  /** Called when the user "checks out" — parent should persist + mark done. */
  onCheckOut: (craft: Craft) => void;
}

type Device = 'desktop' | 'tablet' | 'mobile';
type ViewMode = 'preview' | 'edit' | 'source' | 'files';

const DEVICE_FRAME: Record<Device, { label: string; width: number; aspect: string }> = {
  desktop: { label: 'Desktop', width: 1200, aspect: '16/9' },
  tablet:  { label: 'Tablet',  width: 820,  aspect: '4/3'  },
  mobile:  { label: 'Mobile',  width: 390,  aspect: '9/16' },
};

// Mode visual identity. The band classes are applied to the top header
// strip and to the manual-edit ribbon; the chip classes are used for tabs.
const MODE_THEME: Record<CraftFormat, {
  label: string;
  icon: typeof FileText;
  band: string;
  tabActive: string;
  tabHover: string;
  chip: string;
}> = {
  documentation: {
    label: 'Documentation',
    icon: FileText,
    band: 'bg-gradient-to-r from-[#0F2A52] to-[#1B4FA7]',
    tabActive: 'bg-[#1B4FA7] text-white border-[#1B4FA7]',
    tabHover: 'hover:text-[#1B4FA7]',
    chip: 'bg-[#1B4FA7]/10 text-[#1B4FA7]',
  },
  presentation: {
    label: 'Presentation',
    icon: Presentation,
    band: 'bg-gradient-to-r from-[#B7410E] to-[#E2722C]',
    tabActive: 'bg-[#B7410E] text-white border-[#B7410E]',
    tabHover: 'hover:text-[#B7410E]',
    chip: 'bg-[#B7410E]/10 text-[#B7410E]',
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Heuristic until the Edge Function returns real usage numbers. ~1 token / 4 chars.
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

function emptySession(elementId: string, title: string, format: CraftFormat): CraftSession {
  return {
    element_id: elementId,
    title,
    format,
    messages: [],
    draftHtml: null,
    updated_at: nowIso(),
  };
}

export function CraftWorkspace({ element, initialFormat = 'documentation', onClose, onCheckOut }: Props) {
  const [format, setFormat] = useState<CraftFormat>(initialFormat);
  // Each (element, format) pair gets its own persisted session, so swapping
  // tabs preserves both drafts.
  const [session, setSession] = useState<CraftSession>(() =>
    loadSession(element.id, initialFormat) ??
    emptySession(element.id, `${element.title} — ${MODE_THEME[initialFormat].label}`, initialFormat)
  );
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [activeFile, setActiveFile] = useState(0);
  const [commentMode, setCommentMode] = useState(false);
  const [pins, setPins] = useState<CommentPin[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const theme = MODE_THEME[format];

  // Switch to a different format: load that format's session (or create one).
  useEffect(() => {
    const next =
      loadSession(element.id, format) ??
      emptySession(element.id, `${element.title} — ${MODE_THEME[format].label}`, format);
    setSession(next);
    setError(null);
    setPins([]);
    setCommentMode(false);
    if (viewMode === 'files') setViewMode('preview');
    if (format === 'documentation' && device === 'mobile') setDevice('desktop');
    // We intentionally skip viewMode/device deps to avoid a feedback loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, element.id]);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.messages.length, isGenerating]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Listen for click pins from the sandboxed iframe (comment mode only).
  useEffect(() => {
    if (!commentMode) return;
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== 'craft:comment-pin') return;
      const pin: CommentPin = {
        id: newId('pin'),
        selector: String(data.selector || ''),
        snippet: String(data.snippet || ''),
        note: '',
        created_at: nowIso(),
      };
      setPins((prev) => [...prev, pin]);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [commentMode]);

  // Build the iframe src. In comment mode we inject the click bridge and
  // relax sandbox to allow-scripts (still null origin, so the script
  // cannot reach the parent except via postMessage).
  const previewSrc = useMemo(() => {
    if (!session.draftHtml) return null;
    const html = commentMode ? withBridge(session.draftHtml) : session.draftHtml;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }, [session.draftHtml, commentMode]);

  const files = useMemo(
    () => (session.draftHtml ? splitHtml(session.draftHtml) : []),
    [session.draftHtml]
  );

  const totalTokensEstimate = useMemo(() => {
    return session.messages.reduce(
      (sum, m) => sum + estimateTokens(m.content) + estimateTokens(m.html ?? ''),
      0
    );
  }, [session.messages]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || isGenerating) return;
    setError(null);
    const augmented = buildPinnedPrompt(text, pins);
    const userMsg: CraftMessage = {
      id: newId('m'),
      role: 'user',
      content: text,
      created_at: nowIso(),
    };
    const optimistic: CraftSession = {
      ...session,
      messages: [...session.messages, userMsg],
      updated_at: nowIso(),
    };
    setSession(optimistic);
    setInput('');
    setIsGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const aborted = new Promise<'aborted'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });

    try {
      const result = await Promise.race([
        generateCraft({
          element: { title: element.title, description: element.description ?? null },
          format,
          prompt: augmented,
          history: session.messages,
          currentHtml: session.draftHtml,
        }),
        aborted,
      ]);
      if (result === 'aborted') {
        const note: CraftMessage = {
          id: newId('m'),
          role: 'assistant',
          content: '(キャンセルされました)',
          created_at: nowIso(),
        };
        setSession({
          ...optimistic,
          messages: [...optimistic.messages, note],
          updated_at: nowIso(),
        });
        return;
      }
      const assistantMsg: CraftMessage = {
        id: newId('m'),
        role: 'assistant',
        content: result.reply || (result.html ? '(deck updated)' : '(no reply)'),
        html: result.html ?? undefined,
        created_at: nowIso(),
      };
      setSession({
        ...optimistic,
        messages: [...optimistic.messages, assistantMsg],
        draftHtml: result.html ?? optimistic.draftHtml,
        updated_at: nowIso(),
      });
      if (pins.length > 0) setPins([]);
    } catch (e) {
      setError((e as Error).message || 'Failed to generate');
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleManualEditChange = (newHtml: string) => {
    setSession({ ...session, draftHtml: newHtml, updated_at: nowIso() });
  };

  const handleCheckOut = () => {
    if (!session.draftHtml) return;
    const craft: Craft = {
      id: newId('craft'),
      element_id: element.id,
      title: session.title || `${element.title} — ${theme.label}`,
      format,
      html: session.draftHtml,
      status: 'final',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    onCheckOut(craft);
    clearSession(element.id, format);
    onClose();
  };

  const handleReset = () => {
    if (!confirm('現在のチャット履歴とドラフトを破棄します。よろしいですか?')) return;
    const fresh = emptySession(
      element.id,
      `${element.title} — ${theme.label}`,
      format
    );
    setSession(fresh);
    setPins([]);
    setError(null);
  };

  const handleDownload = () => {
    if (!session.draftHtml) return;
    const blob = new Blob([session.draftHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // PDF via the browser's print dialog ("Save as PDF"). No server dependency.
  const handlePrintPdf = () => {
    if (!session.draftHtml) return;
    const w = window.open('', '_blank', 'width=1200,height=900');
    if (!w) return;
    const printCss =
      format === 'presentation'
        ? `<style>@page { size: 1600px 900px; margin: 0; } html, body { margin: 0; padding: 0; } .slide { page-break-after: always; }</style>`
        : `<style>@page { size: A4; margin: 18mm; }</style>`;
    const doc = session.draftHtml.includes('</head>')
      ? session.draftHtml.replace('</head>', `${printCss}</head>`)
      : printCss + session.draftHtml;
    w.document.open();
    w.document.write(doc);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  };

  const frame = DEVICE_FRAME[device];
  const sandboxAttr = commentMode ? 'allow-scripts' : '';
  const templates = templatesFor(format);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Mode band — solid colored strip identifying Documentation vs Presentation. */}
      <div className={`h-2.5 ${theme.band}`} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={16} className="text-amber-500 shrink-0" />
          <span className="text-[13px] font-medium text-foreground truncate">{session.title}</span>
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded shrink-0 ${theme.chip}`}>
            {theme.label}
          </span>
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 shrink-0 ml-2 px-1.5 py-0.5 bg-muted/40 rounded">
            <Hash size={10} /> ~{totalTokensEstimate.toLocaleString()} tok
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title="Reset session"
          >
            <RotateCcw size={13} /> Reset
          </button>
          <button
            onClick={handleDownload}
            disabled={!session.draftHtml}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={13} /> HTML
          </button>
          <button
            onClick={handlePrintPdf}
            disabled={!session.draftHtml}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Open print dialog (Save as PDF)"
          >
            <Printer size={13} /> PDF
          </button>
          <button
            onClick={handleCheckOut}
            disabled={!session.draftHtml}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={13} /> Check out
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            title="Close (chat is auto-saved)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex items-center gap-1 px-4 pt-2 border-b border-border bg-card/40">
        {(Object.keys(MODE_THEME) as CraftFormat[]).map((f) => {
          const t = MODE_THEME[f];
          const Icon = t.icon;
          const active = f === format;
          return (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-t-md border-b-2 transition-colors ${
                active
                  ? `${t.tabActive} border-current`
                  : `text-muted-foreground border-transparent ${t.tabHover}`
              }`}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Body — split: chat on the left, preview on the right */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[420px_1fr]">
        {/* Chat column */}
        <div className="flex flex-col border-r border-border min-h-0">
          <div ref={scrollerRef} className="flex-1 overflow-auto px-4 py-4 space-y-4">
            {session.messages.length === 0 && (
              <div className="space-y-4">
                <p className="text-[13px] text-muted-foreground">
                  {format === 'documentation'
                    ? 'Element の文脈を読み込みました。下のテンプレからクイックに始めるか、自由に指示を書いてください。1 ページのドキュメントを生成します。'
                    : 'Element の文脈を読み込みました。下のテンプレからクイックに始めるか、自由に指示を書いてください。スライドデッキを生成します。'}
                </p>
                <div>
                  <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
                    Templates
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => send(tpl.prompt)}
                        className="text-left px-2.5 py-2 rounded-md bg-muted/40 hover:bg-muted transition-colors"
                      >
                        <span className="text-[14px] mr-1.5">{tpl.emoji}</span>
                        <span className="text-[12px] text-foreground">{tpl.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {session.messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {isGenerating && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 size={13} className="animate-spin" /> generating…
              </div>
            )}
            {error && (
              <div className="text-[12px] text-red-500 bg-red-500/10 px-3 py-2 rounded-md">
                {error}
              </div>
            )}
          </div>

          {pins.length > 0 && (
            <div className="border-t border-border px-3 py-2 bg-muted/20 space-y-1.5 max-h-40 overflow-auto">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Pin size={10} /> Pins ({pins.length})
                </span>
                <button
                  onClick={() => setPins([])}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              {pins.map((pin, i) => (
                <div key={pin.id} className="flex items-start gap-2 text-[11.5px] bg-card border border-border rounded px-2 py-1.5">
                  <span className="font-mono text-amber-600 shrink-0">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-muted-foreground truncate" title={pin.selector}>{pin.selector}</div>
                    <input
                      type="text"
                      value={pin.note}
                      onChange={(e) =>
                        setPins((prev) => prev.map((p) => (p.id === pin.id ? { ...p, note: e.target.value } : p)))
                      }
                      placeholder="この要素への指示 (任意)"
                      className="mt-1 w-full text-[11.5px] bg-transparent border-none focus:outline-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  <button
                    onClick={() => setPins((prev) => prev.filter((p) => p.id !== pin.id))}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={
                  pins.length > 0
                    ? 'ピンした要素をどう書き換える?'
                    : format === 'documentation'
                      ? '例: KPI セクションを表で見せて'
                      : '例: 5 枚構成にして、表紙はもっと余白を多く'
                }
                rows={2}
                className="flex-1 text-[13px] bg-muted/40 rounded-md px-3 py-2 resize-none border-none focus:outline-none"
              />
              {isGenerating ? (
                <button
                  onClick={handleCancel}
                  className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Cancel generation"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  className="p-2 rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Send (⌘/Ctrl + Enter)"
                >
                  <Send size={14} />
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-muted-foreground mt-1.5 px-1">
              ⌘/Ctrl + Enter で送信。チャット履歴と最新ドラフトはローカルに自動保存されます。
            </p>
          </div>
        </div>

        {/* Preview column */}
        <div className="flex flex-col min-h-0 bg-muted/20">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/40">
            <Eye size={12} className="text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              {viewMode === 'preview' ? 'Preview'
                : viewMode === 'edit' ? 'Edit'
                : viewMode === 'source' ? 'Source'
                : 'Files'}
            </span>
            <div className="flex items-center gap-0.5 ml-2">
              <ToolbarBtn active={viewMode === 'preview'} onClick={() => setViewMode('preview')} title="Preview">
                <Eye size={12} />
              </ToolbarBtn>
              <ToolbarBtn active={viewMode === 'edit'} onClick={() => setViewMode('edit')} title="Manual edit (人が書く)" disabled={!session.draftHtml}>
                <Pencil size={12} />
              </ToolbarBtn>
              <ToolbarBtn active={viewMode === 'source'} onClick={() => setViewMode('source')} title="Source">
                <Code2 size={12} />
              </ToolbarBtn>
              <ToolbarBtn active={viewMode === 'files'} onClick={() => setViewMode('files')} title="Files">
                <Files size={12} />
              </ToolbarBtn>
            </div>
            {viewMode === 'preview' && (
              <>
                <div className="flex items-center gap-0.5 ml-2">
                  <ToolbarBtn active={device === 'desktop'} onClick={() => setDevice('desktop')} title="Desktop">
                    <Monitor size={12} />
                  </ToolbarBtn>
                  <ToolbarBtn active={device === 'tablet'} onClick={() => setDevice('tablet')} title="Tablet">
                    <Tablet size={12} />
                  </ToolbarBtn>
                  <ToolbarBtn active={device === 'mobile'} onClick={() => setDevice('mobile')} title="Mobile">
                    <Smartphone size={12} />
                  </ToolbarBtn>
                </div>
                <div className="ml-2">
                  <ToolbarBtn
                    active={commentMode}
                    onClick={() => setCommentMode((v) => !v)}
                    title={commentMode ? 'Comment mode ON' : 'Click an element to pin it'}
                  >
                    <MessageSquarePlus size={12} />
                  </ToolbarBtn>
                </div>
              </>
            )}
            <span className="text-[11px] text-muted-foreground/70 ml-auto">
              {viewMode === 'preview'
                ? `sandbox · ${frame.label} (${frame.width}px)${commentMode ? ' · click to pin' : ''}`
                : viewMode === 'edit'
                  ? '直接編集 — Bold / Heading / List etc.'
                  : viewMode === 'source'
                    ? `${(session.draftHtml?.length ?? 0).toLocaleString()} chars`
                    : `${files.length} files`}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {!session.draftHtml ? (
              <div className="h-full flex items-start justify-center p-6">
                <div className="text-center text-[13px] text-muted-foreground mt-24">
                  <Sparkles size={28} className="mx-auto mb-3 text-muted-foreground/50" />
                  プレビューはまだ空です。左のチャットから指示を送ってください。
                </div>
              </div>
            ) : viewMode === 'preview' && previewSrc ? (
              <div className="h-full overflow-auto p-6 flex items-start justify-center">
                <iframe
                  key={previewSrc.slice(0, 64) + device + (commentMode ? '-comment' : '')}
                  src={previewSrc}
                  sandbox={sandboxAttr}
                  title="Craft preview"
                  style={{ width: frame.width, aspectRatio: frame.aspect }}
                  className="bg-white rounded-md shadow-lg border border-border max-w-full"
                />
              </div>
            ) : viewMode === 'edit' ? (
              <ManualEditor
                html={session.draftHtml}
                onChange={handleManualEditChange}
                bandClass={theme.band}
                modeLabel={theme.label}
              />
            ) : viewMode === 'source' ? (
              <div className="h-full overflow-auto p-6 flex items-start justify-center">
                <pre className="w-full max-w-[1200px] text-[12px] leading-relaxed bg-card border border-border rounded-md p-4 overflow-auto whitespace-pre-wrap break-all font-mono">
                  {session.draftHtml}
                </pre>
              </div>
            ) : (
              <div className="h-full overflow-auto p-6 flex items-start justify-center">
                <FilesView files={files} active={activeFile} onSelect={setActiveFile} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({
  active, onClick, title, children, disabled,
}: { active: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  );
}

function ChatBubble({ message }: { message: CraftMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] text-[13px] leading-relaxed px-3 py-2 rounded-lg whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-foreground text-background'
            : 'bg-muted/60 text-foreground'
        }`}
      >
        {message.content}
        {message.html && !isUser && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            ↳ プレビュー更新済み · ~{estimateTokens(message.html).toLocaleString()} tok
          </div>
        )}
      </div>
    </div>
  );
}

function FilesView({
  files, active, onSelect,
}: {
  files: { name: string; language: string; content: string }[];
  active: number;
  onSelect: (idx: number) => void;
}) {
  const file = files[active] ?? files[0];
  return (
    <div className="w-full max-w-[1200px] grid grid-cols-[200px_1fr] gap-3">
      <div className="bg-card border border-border rounded-md p-2 space-y-0.5 h-fit">
        {files.map((f, i) => (
          <button
            key={f.name}
            onClick={() => onSelect(i)}
            className={`w-full text-left text-[12px] px-2 py-1.5 rounded transition-colors flex items-center gap-2 ${
              i === active ? 'bg-foreground text-background' : 'text-foreground/80 hover:bg-muted'
            }`}
          >
            <Files size={11} className="opacity-70" />
            <span className="truncate font-mono">{f.name}</span>
          </button>
        ))}
      </div>
      <pre className="text-[12px] leading-relaxed bg-card border border-border rounded-md p-4 overflow-auto whitespace-pre-wrap break-all font-mono min-h-[300px]">
        {file?.content || ''}
      </pre>
    </div>
  );
}
