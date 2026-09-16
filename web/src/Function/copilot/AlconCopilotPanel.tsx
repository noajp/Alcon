'use client';
import { Button } from '@/ui/button';

import { useEffect, useRef, useState } from 'react';
import { X, ChevronRight, Loader2, Wrench, AlertCircle, CheckCircle2 } from 'lucide-react';
import { SendIcon } from '@/Function/shared/SendIcon';
import { useAlconCopilot, type CopilotContext, type ToolEvent } from './useAlconCopilot';
import { getActiveDomainId } from '@/ActivitySpace/execution/domain/domainsStore';

const WIDTH_KEY = 'alcon.copilot.width';
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 340;

export interface AlconCopilotPanelProps {
  /** Open state is owned by the page so the status bar's PanelRight
   *  toggle and the ⌘L shortcut both flip the same boolean — sharing via a
   *  CustomEvent is fragile under React 18 StrictMode (the listener gets
   *  re-attached and a single click flips state twice). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Right-edge floating Copilot pane. Open state lives in the parent (toggled
 * with Cmd/Ctrl+L globally, by the status bar's PanelRight button, or by
 * the panel's own close button). Width is user-resizable from a left-side
 * drag handle and persisted via localStorage. Phase 1 ships read-only tools;
 * the deliverable-creating Code / Terminal tabs are stubbed at the bottom
 * for future work but disabled.
 */
export function AlconCopilotPanel({ open, onOpenChange }: AlconCopilotPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);
  const { messages, streaming, error, send, cancel, reset } = useAlconCopilot();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate persisted UI prefs once.
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) setWidth(w);
    } catch { /* SSR / private mode */ }
    setHydrated(true);
  }, []);

  // Track active Domain (Domains store keeps it in localStorage; re-read on
  // open + on storage events so a Domain switch from elsewhere is reflected).
  useEffect(() => {
    const sync = () => setActiveDomainId(getActiveDomainId());
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [open]);

  // Cmd/Ctrl+L toggles the panel. Cmd+L collides with Chrome's address-bar
  // focus; that's acceptable inside a SPA where the address bar is rarely
  // the target.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Auto-scroll to bottom on new content while streaming.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming]);

  // Auto-focus the input when the panel opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);


  // ── Drag-to-resize from the left edge ──────────────────────────────────
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (startX - ev.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Persist final width on the next render after a drag completes.
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width, hydrated]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const ctx: CopilotContext = {
      viewLabel: 'Alcon',
      domainId: activeDomainId ?? undefined,
    };
    send(text, { context: ctx });
  };

  // Render nothing until hydration finishes so the initial CSR matches the
  // SSR'd HTML (avoids a flash of an open panel when localStorage said open).
  if (!hydrated) return null;

  return (
    <>
      {/* Open / close is driven by the status bar's PanelRight button
          (and ⌘L), so the panel itself renders nothing in the closed state.
          Mouse re-entry: the user clicks the same toggle in the tab bar. */}
      {open && (
        <aside
          style={{ width }}
          className="relative flex flex-col bg-white dark:bg-card rounded-lg border border-border/30 shadow-[var(--shadow-island)] overflow-hidden flex-shrink-0"
        >
          {/* Left-edge drag handle to resize. Now lives just outside the
              rounded island so it sits between the two cards rather than
              on top of the conversation. */}
          <div
            onMouseDown={startResize}
            className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize hover:bg-foreground/10 transition-colors z-10"
            aria-hidden
          />

          {/* Header — h-[50px] + border-border/60 to line up with the
              HierarchyHeader / list / overview headers in the main island
              so a single horizontal divider runs across both panes. */}
          <div className="h-[50px] flex items-center gap-2 px-3 border-b border-border/60 bg-card flex-shrink-0">
            <span className="text-[13px] font-semibold text-foreground">AI</span>
            <div className="flex-1" />
            {messages.length > 0 && (
              <Button size="sm"
                type="button"
                onClick={reset}
                title="会話をクリア"
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </Button>
            )}
            {/* Close lives on the status bar's PanelRight toggle (and ⌘L);
                a header X would just duplicate that affordance. */}
          </div>

          {/* Conversation — empty state is intentionally blank; the placeholder
              in the composer is the only nudge. */}
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-[12.5px] leading-relaxed">
            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} content={m.content} toolEvents={m.toolEvents} streaming={streaming && i === messages.length - 1 && !m.done} />
            ))}
            {error && (
              <div className="rounded-md bg-rose-500/10 border border-rose-500/20 px-2.5 py-2 text-[11.5px] text-rose-400">
                {error}
              </div>
            )}
          </div>

          {/* Composer — pill-shaped "terminal" floating inside the island.
              No section divider above it; the soft border + small shadow do
              the lifting. The conversation list breathes above. */}
          <div className="px-3 pb-3 pt-1">
            <form
              onSubmit={(e) => { e.preventDefault(); submit(); }}
              className="flex items-end gap-2 rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] px-3 py-2"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={1}
                placeholder={streaming ? '…' : 'type anything'}
                disabled={streaming}
                className="flex-1 resize-none bg-transparent text-[12.5px] leading-[1.5] py-1.5 max-h-32 min-h-[24px] disabled:opacity-60"
                style={{ fontWeight: 400 }}
              />
              {streaming ? (
                <Button size="icon-sm"
                  type="button"
                  onClick={cancel}
                  title="停止"
                  aria-label="Stop"
                  variant="ghost"
                >
                  <X size={14} />
                </Button>
              ) : (
                <Button size="icon-sm"
                  type="submit"
                  disabled={!input.trim()}
                  title="送信 (Enter)"
                  aria-label="Send"
                  variant="primary"
                >
                  <SendIcon size={16} />
                </Button>
              )}
            </form>
          </div>
        </aside>
      )}
    </>
  );
}

function MessageBubble({
  role, content, toolEvents, streaming,
}: { role: 'user' | 'assistant'; content: string; toolEvents?: ToolEvent[]; streaming?: boolean }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary/15 border border-primary/20 text-foreground px-2.5 py-1.5 whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {toolEvents && toolEvents.length > 0 && (
        <div className="space-y-1">
          {toolEvents.map((t, i) => <ToolChip key={i} event={t} />)}
        </div>
      )}
      <div className="whitespace-pre-wrap break-words text-foreground/95">
        {content || (streaming && <Loader2 size={13} className="inline animate-spin text-muted-foreground" />)}
      </div>
    </div>
  );
}

function ToolChip({ event }: { event: ToolEvent }) {
  const status: 'running' | 'ok' | 'error' =
    !event.result ? 'running' : event.result.ok ? 'ok' : 'error';
  const Icon = status === 'running' ? Loader2 : status === 'ok' ? CheckCircle2 : AlertCircle;
  const tone =
    status === 'running' ? 'text-muted-foreground' :
    status === 'ok'      ? 'text-emerald-500' :
                           'text-rose-500';
  const summary = event.result?.ok
    ? (event.result.rows != null ? `${event.result.rows} 件` : 'ok')
    : (event.result?.error ?? '');

  return (
    <div className={`inline-flex items-center gap-1.5 max-w-full text-[11px] px-1.5 py-0.5 rounded-md bg-muted/30 border border-border/60 ${tone}`}>
      <Wrench size={10} className="opacity-70 shrink-0" />
      <span className="font-mono opacity-90 truncate">{event.name}</span>
      <ChevronRight size={10} className="opacity-50 shrink-0" />
      <Icon size={11} className={`shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} />
      {summary && <span className="opacity-80 truncate">{summary}</span>}
    </div>
  );
}
