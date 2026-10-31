'use client';
import dynamic from 'next/dynamic';
import { Button } from '@/ui/button';

import { useEffect, useRef, useState } from 'react';
import { X, ChevronRight, Loader2, Wrench, AlertCircle, CheckCircle2, Maximize2, Minimize2 } from 'lucide-react';
import { SendIcon } from '@/Function/shared/SendIcon';
import { type CopilotContext, type ToolEvent } from './useAlconCopilot';
import { useCopilotConversation } from './CopilotProvider';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { getActiveDomainId } from '@/Function/space/domainsStore';
import { useI18n } from '@/Function/i18n/I18nProvider';

const SlidesAssistant = dynamic(() => import('@/ActivitySpace/sustainment/slides/SlidesAssistant').then((m) => m.SlidesAssistant), { ssr: false });

const FLOAT_KEY = 'alcon.copilot.float';
const FLOAT_MIN_W = 320;
const FLOAT_MIN_H = 280;

/** The pop-up's place, measured from the bottom-right corner of the page so
 *  it stays in that corner when the window changes size. */
interface FloatRect { right: number; bottom: number; width: number; height: number }
type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const EDGE_CLASS: Record<Edge, string> = {
  n: 'left-3 right-3 top-0 h-2 cursor-ns-resize',
  s: 'left-3 right-3 bottom-0 h-2 cursor-ns-resize',
  w: 'top-3 bottom-3 left-0 w-2 cursor-ew-resize',
  e: 'top-3 bottom-3 right-0 w-2 cursor-ew-resize',
  nw: 'left-0 top-0 h-4 w-4 cursor-nwse-resize',
  se: 'right-0 bottom-0 h-4 w-4 cursor-nwse-resize',
  ne: 'right-0 top-0 h-4 w-4 cursor-nesw-resize',
  sw: 'left-0 bottom-0 h-4 w-4 cursor-nesw-resize',
};

function readFloatRect(): FloatRect | null {
  try {
    const v = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? 'null');
    if (v && [v.right, v.bottom, v.width, v.height].every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) return v;
  } catch { /* private mode */ }
  return null;
}

export interface AlconCopilotPanelProps {
  /** Open state is owned by the page so the corner button, ⌘L and the
   *  panel's own close all flip the same boolean. Ignored on the AI screen. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the screen is about, when the panel should speak to it rather than
   *  to Alcon at large — 'slides' makes it the open deck's assistant. */
  subject?: 'slides' | null;
  /** floating: a pop-up above the corner button, moved by its title bar and
   *  sized from any edge. page: the AI screen, the whole island. */
  variant?: 'floating' | 'page';
  /** The pop-up's expand button: open the AI screen. */
  onExpand?: () => void;
  /** The AI screen's shrink button: back to the pop-up. */
  onMinimize?: () => void;
}

/**
 * The AI. One conversation (CopilotProvider) shown as a pop-up or a screen of
 * its own; on Slides the pop-up is the open deck's assistant. Phase 1 ships
 * read-only tools.
 */
export function AlconCopilotPanel({ open, onOpenChange, subject = null, variant = 'floating', onExpand, onMinimize }: AlconCopilotPanelProps) {
  const { t } = useI18n();
  const floating = variant === 'floating';
  const page = variant === 'page';
  const shown = page || open;
  const [rect, setRect] = useState<FloatRect | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);
  const { messages, streaming, error, send, cancel, newConversation } = useCopilotConversation();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLElement>(null);

  // Hydrate the pop-up's kept place once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of stored prefs after mount
    setRect(readFloatRect());
    setHydrated(true);
  }, []);

  // Track active Domain (Domains store keeps it in localStorage; re-read on
  // open + on storage events so a Domain switch from elsewhere is reflected).
  useEffect(() => {
    const sync = () => setActiveDomainId(getActiveDomainId());
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [shown]);

  // Cmd/Ctrl+L toggles the panel; Esc closes the pop-up. The AI screen is
  // left by the rail, so it listens to neither. Cmd+L collides with Chrome's
  // address-bar focus; that's acceptable inside a SPA.
  useEffect(() => {
    if (page) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        onOpenChange(!open);
      } else if (floating && open && e.key === 'Escape' && !e.defaultPrevented) {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, floating, page]);

  // Auto-scroll to bottom on new content while streaming.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming, shown]);

  // Auto-focus the input when the panel opens.
  useEffect(() => {
    if (shown) setTimeout(() => inputRef.current?.focus(), 60);
  }, [shown]);

  // ── Floating: move by the title bar, size from any edge ────────────────
  // Both work in the page's coordinates (the pop-up's offset parent) and
  // keep the whole pop-up inside it.
  const startFloat = (e: React.PointerEvent, edge: Edge | 'move') => {
    const box = boxRef.current;
    const parent = box?.offsetParent as HTMLElement | null;
    if (!box || !parent || e.button !== 0) return;
    e.preventDefault();
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const start: FloatRect = {
      right: pw - box.offsetLeft - box.offsetWidth,
      bottom: ph - box.offsetTop - box.offsetHeight,
      width: box.offsetWidth,
      height: box.offsetHeight,
    };
    const sx = e.clientX;
    const sy = e.clientY;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let last = start;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const next = { ...start };
      if (edge === 'move') {
        next.right = clamp(start.right - dx, 0, pw - start.width);
        next.bottom = clamp(start.bottom - dy, 0, ph - start.height);
      } else {
        if (edge.includes('w')) next.width = clamp(start.width - dx, FLOAT_MIN_W, pw - start.right);
        if (edge.includes('e')) {
          next.width = clamp(start.width + dx, FLOAT_MIN_W, start.width + start.right);
          next.right = start.right - (next.width - start.width);
        }
        if (edge.includes('n')) next.height = clamp(start.height - dy, FLOAT_MIN_H, ph - start.bottom);
        if (edge.includes('s')) {
          next.height = clamp(start.height + dy, FLOAT_MIN_H, start.height + start.bottom);
          next.bottom = start.bottom - (next.height - start.height);
        }
      }
      last = next;
      setRect(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try { localStorage.setItem(FLOAT_KEY, JSON.stringify(last)); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startEdge = (e: React.PointerEvent<HTMLDivElement>) => startFloat(e, e.currentTarget.dataset.edge as Edge);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const ctx: CopilotContext = {
      viewLabel: 'Alcon',
      domainId: activeDomainId ?? undefined,
      spaceId: getActiveSpaceId() ?? undefined,
      today: toDateOnlyString(new Date()),
    };
    send(text, { context: ctx });
  };

  // Render nothing until hydration finishes so the initial CSR matches the
  // SSR'd HTML.
  if (!hydrated || !shown) return null;

  const boxClass = page
    ? 'flex flex-1 flex-col overflow-hidden bg-card'
    : `absolute z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl ${rect ? '' : 'bottom-4 right-4 h-[min(600px,calc(100%-2rem))] w-[400px] max-w-[calc(100%-2rem)]'}`;
  const boxStyle = page ? undefined : (rect ?? undefined);
  // The conversation and composer keep a readable measure on the AI screen.
  const column = page ? 'mx-auto w-full max-w-3xl' : '';

  return (
    <aside ref={boxRef} style={boxStyle} className={boxClass}>
      {floating && (Object.keys(EDGE_CLASS) as Edge[]).map((edge) => (
        <div key={edge} data-edge={edge} onPointerDown={startEdge} className={`absolute z-10 ${EDGE_CLASS[edge]}`} aria-hidden />
      ))}

      {/* Header. On the AI screen it is h-[50px], like every page's header;
          as a pop-up it is a title bar that moves it. */}
      <div
        onPointerDown={floating ? (e) => { if (!(e.target as HTMLElement).closest('button')) startFloat(e, 'move'); } : undefined}
        className={`flex flex-shrink-0 items-center gap-2 bg-card ${floating ? 'h-12 cursor-grab pl-4 pr-2 active:cursor-grabbing' : 'h-[50px] px-3 border-b border-border/60'}`}
      >
        <span className="text-[13px] font-semibold text-foreground">{t('AI')}</span>
        {subject === 'slides' && <span className="text-[12px] text-muted-foreground">· Slides</span>}
        <div className="flex-1" />
        {subject !== 'slides' && messages.length > 0 && (
          <Button size="sm" type="button" variant="ghost" onClick={() => newConversation()} title={t('Start a new conversation')}>
            {t('New conversation')}
          </Button>
        )}
        {floating && onExpand && (
          <Button size="icon-sm" type="button" variant="ghost" onClick={onExpand}
            title={t('Open the AI screen')} aria-label={t('Open the AI screen')} className="text-muted-foreground">
            <Maximize2 size={14} />
          </Button>
        )}
        {page && onMinimize && (
          <Button size="icon-sm" type="button" variant="ghost" onClick={onMinimize}
            title={t('Shrink to a pop-up')} aria-label={t('Shrink to a pop-up')} className="text-muted-foreground">
            <Minimize2 size={14} />
          </Button>
        )}
        {!page && (
          <Button size="icon-sm" type="button" variant="ghost" onClick={() => onOpenChange(false)}
            title={`${t('Hide AI')} (⌘L)`} aria-label={t('Hide AI')} className="text-muted-foreground">
            <X size={14} />
          </Button>
        )}
      </div>

      {/* One AI panel across the app: on Slides it is the open deck's
          assistant (its conversation and composer), elsewhere Alcon's. */}
      {subject === 'slides' ? <SlidesAssistant /> : <>
      {/* Conversation — empty state is intentionally blank; the placeholder
          in the composer is the only nudge. */}
      <div ref={listRef} className={`flex-1 overflow-y-auto py-3 text-[12.5px] leading-relaxed ${page ? 'px-8' : 'px-3'}`}>
        <div className={`space-y-3 ${column}`}>
          {messages.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} toolEvents={m.toolEvents} streaming={streaming && i === messages.length - 1 && !m.done} />
          ))}
          {error && (
            <div role="alert" className="text-[11.5px] text-[var(--status-danger)]">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Composer — a soft-bordered box floating at the foot. */}
      <div className={`pb-3 pt-1 ${page ? 'px-8 pb-6' : 'px-3'}`}>
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className={`flex items-end gap-2 rounded-lg bg-[var(--surface-rail)] border border-border/30 shadow-[var(--shadow-island)] px-3 py-2 ${column}`}
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
            placeholder={streaming ? '…' : t('Type anything')}
            aria-label={t('Message AI')}
            disabled={streaming}
            className="flex-1 resize-none bg-transparent text-[12.5px] leading-[1.5] py-1.5 max-h-32 min-h-[24px] disabled:opacity-60"
            style={{ fontWeight: 400 }}
          />
          {streaming ? (
            <Button size="icon-sm" type="button" onClick={cancel} title={t('Stop')} aria-label={t('Stop')} variant="ghost">
              <X size={14} />
            </Button>
          ) : (
            <Button size="icon-sm" type="submit" disabled={!input.trim()} title={t('Send (Enter)')} aria-label={t('Send')} variant="primary">
              <SendIcon size={16} />
            </Button>
          )}
        </form>
      </div>
      </>}
    </aside>
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
          {toolEvents.map((event, i) => <ToolChip key={i} event={event} />)}
        </div>
      )}
      <div className="whitespace-pre-wrap break-words text-foreground/95">
        {content || (streaming && <Loader2 size={13} className="inline animate-spin text-muted-foreground" />)}
      </div>
    </div>
  );
}

function ToolChip({ event }: { event: ToolEvent }) {
  const { t } = useI18n();
  const status: 'running' | 'ok' | 'error' =
    !event.result ? 'running' : event.result.ok ? 'ok' : 'error';
  const Icon = status === 'running' ? Loader2 : status === 'ok' ? CheckCircle2 : AlertCircle;
  const tone =
    status === 'running' ? 'text-muted-foreground' :
    status === 'ok'      ? 'text-[var(--status-success)]' :
                           'text-[var(--status-danger)]';
  const summary = event.result?.ok
    ? (event.result.rows != null ? t('{n} rows', { n: event.result.rows }) : t('OK'))
    : (event.result?.error ?? '');

  return (
    <div className={`inline-flex items-center gap-1.5 max-w-full text-[11px] px-1.5 py-0.5 rounded-md bg-muted/40 ${tone}`}>
      <Wrench size={10} className="opacity-70 shrink-0" />
      <span className="font-mono opacity-90 truncate">{event.name}</span>
      <ChevronRight size={10} className="opacity-50 shrink-0" />
      <Icon size={11} className={`shrink-0 ${status === 'running' ? 'animate-spin' : ''}`} />
      {summary && <span className="opacity-80 truncate">{summary}</span>}
    </div>
  );
}
