'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, ChevronDown, Copy, Loader2, RotateCcw, Wrench } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { formatToolDuration, toolCallText, highlightTokens } from './toolCallFormat';

// One tool call of an AI turn, as a card: the tool's icon, its name in mono,
// a short summary and the status (a spinner with a live timer, a check with
// the time it took, or Failed). Opened, it shows the arguments and the
// result as highlighted JSON, each with a copy button; a long block is
// capped with a fade and "Show all". A failed call shows its message and,
// when the host can redo it, Retry.
//
// Colors, radii and shadows are the app's tokens, so every theme carries it.

export type ToolCallStatus = 'running' | 'success' | 'error';

export type ToolCallCardProps = {
  /** The tool's name as the agent calls it, shown in mono. */
  name: string;
  /** A short line saying what the call did. */
  summary?: ReactNode;
  icon?: ReactNode;
  status: ToolCallStatus;
  /** The call's arguments: objects are pretty-printed, JSON strings parsed. */
  args?: unknown;
  /** What the call returned, shown the same way. */
  result?: unknown;
  error?: string;
  /** When the call started (ms since epoch): the live timer counts from here. */
  startedAt?: number;
  /** The call's duration in ms; otherwise measured while it shows running. */
  duration?: number;
  defaultOpen?: boolean;
  /** Opens the card when the call fails, and closes it again on the next run
   *  unless someone opened or closed it by hand. */
  openOnError?: boolean;
  onRetry?: () => void;
  /** Height in px past which a code block is capped. */
  maxCodeHeight?: number;
  className?: string;
};

export function ToolCallCard({
  name, summary, icon, status, args, result, error, startedAt, duration,
  defaultOpen = false, openOnError = true, onRetry, maxCodeHeight = 220, className,
}: ToolCallCardProps) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [prevStatus, setPrevStatus] = useState(status);
  const [autoOpened, setAutoOpened] = useState(false);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (openOnError && status === 'error' && !open) { setOpen(true); setAutoOpened(true); }
    else if (prevStatus === 'error' && autoOpened) { setOpen(false); setAutoOpened(false); }
  }

  const measured = useStopwatch(status === 'running', startedAt, false);
  const ms = status === 'running' ? (measured ?? 0) : (duration ?? measured);
  const announce = status === 'running' ? t('{name} running', { name })
    : status === 'success' ? t('{name} finished', { name }) : t('{name} failed', { name });

  return (
    <div data-status={status} className={cn(
      'min-w-0 rounded-[var(--radius-md)] bg-card text-[13px] leading-5 text-foreground',
      'shadow-[0_0_0_0.5px_var(--border-subtle),var(--shadow-1)]',
      className,
    )}>
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
      <button type="button" aria-expanded={open} aria-controls={`${id}-body`}
        onClick={() => { setAutoOpened(false); setOpen(!open); }}
        className={cn(
          'group/head flex min-h-11 w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-muted/40',
          open ? 'rounded-t-[var(--radius-md)]' : 'rounded-[var(--radius-md)]',
          'focus-visible:bg-muted/60',
        )}>
        <span className="grid size-4 shrink-0 place-items-center text-muted-foreground [&>svg]:size-4" aria-hidden="true">
          {icon ?? <Wrench strokeWidth={1.6} />}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <code className="max-w-[55%] shrink truncate font-mono text-[12px] font-medium text-foreground" title={name}>{name}</code>
          {summary != null && (
            <span dir="auto" className="min-w-0 flex-1 truncate text-muted-foreground"
              title={typeof summary === 'string' ? summary : undefined}>{summary}</span>
          )}
        </span>
        <span key={status} className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] leading-4 tabular-nums animate-fade-in',
          status === 'error' ? 'font-medium text-[var(--status-danger)]' : 'text-muted-foreground',
        )}>
          {status === 'running' && <Loader2 size={14} className="animate-spin text-[var(--accent-default)]" aria-hidden="true" />}
          {status === 'success' && (
            <span className="grid size-3.5 place-items-center rounded-full bg-[var(--accent-default)] text-[var(--primary-foreground)]" aria-hidden="true">
              <Check size={9} strokeWidth={3} />
            </span>
          )}
          {status === 'error' && <AlertCircle size={14} aria-hidden="true" />}
          <span>{status === 'error' ? t('Failed') : ms != null ? formatToolDuration(ms, status === 'running') : null}</span>
        </span>
        <ChevronDown size={12} aria-hidden="true"
          className={cn('shrink-0 text-muted-foreground transition-transform duration-300 group-hover/head:text-foreground', open && 'rotate-180')} />
      </button>

      <div id={`${id}-body`} inert={!open}
        className={cn('grid transition-[grid-template-rows,opacity] duration-300', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-3.5 border-t border-[var(--border-subtle)] px-3.5 pb-3.5 pt-3">
            {status === 'error' && (
              <div className="flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--status-danger-subtle)] py-2 pl-3 pr-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0 self-start text-[var(--status-danger)]" aria-hidden="true" />
                <p dir="auto" className="max-h-[200px] min-w-0 flex-1 overflow-y-auto whitespace-pre-line break-words text-[13px] text-[var(--status-danger)]">
                  {error ?? t('The tool call failed.')}
                </p>
                {onRetry && (
                  <button type="button" onClick={onRetry}
                    className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-xs)] bg-card pl-1.5 pr-2.5 text-[13px] font-medium shadow-[0_0_0_0.5px_var(--border-subtle)] hover:bg-muted/40">
                    <RotateCcw size={14} className="text-muted-foreground" aria-hidden="true" />
                    {t('Retry')}
                  </button>
                )}
              </div>
            )}
            {args !== undefined && <CodeSection label={t('Arguments')} value={args} cap={maxCodeHeight} />}
            {result !== undefined ? (
              <CodeSection label={t('Result')} value={result} cap={maxCodeHeight} />
            ) : status === 'running' ? (
              <div className="grid gap-1.5">
                <SectionLabel>{t('Result')}</SectionLabel>
                <p className="text-[12px] leading-4 text-muted-foreground">{t('Waiting for result…')}</p>
              </div>
            ) : null}
            {args === undefined && result === undefined && status === 'success' && (
              <p className="text-[12px] leading-4 text-muted-foreground">{t('No arguments or result.')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const OPEN_MAX = 640;

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium leading-4 text-muted-foreground">{children}</span>;
}

function CodeSection({ label, value, cap }: { label: string; value: unknown; cap: number }) {
  const { t } = useI18n();
  const { text, json } = toolCallText(value);
  const pre = useRef<HTMLPreElement>(null);
  const [full, setFull] = useState(false);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = pre.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const measure = () => setHeight(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [text]);

  const capped = height > cap + 24;
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        <CopyButton text={text} />
      </div>
      <pre ref={pre}
        style={capped ? { maxHeight: full ? Math.min(height, OPEN_MAX) : cap } : undefined}
        className={cn(
          'relative m-0 whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-muted px-3 py-2.5 font-mono text-[12px] leading-5 text-muted-foreground',
          'shadow-[inset_0_0_0_0.5px_var(--border-subtle)] transition-[max-height] duration-500 [overflow-wrap:anywhere] [tab-size:2]',
          capped && full && height > OPEN_MAX ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden',
          // The fade that says a capped block goes on.
          'after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-14 after:bg-gradient-to-b after:from-transparent after:to-[var(--muted)] after:transition-opacity',
          capped && !full ? 'after:opacity-100' : 'after:opacity-0',
        )}>
        <code className="block">{json ? <Highlighted text={text} /> : text}</code>
      </pre>
      {capped && (
        <button type="button" aria-expanded={full} onClick={() => setFull(!full)}
          className="-ml-1 justify-self-start rounded-md px-1 py-0.5 text-[12px] font-medium leading-4 text-muted-foreground transition-colors hover:text-foreground">
          {full ? t('Show less') : t('Show all')}
        </button>
      )}
    </div>
  );
}

const TOKEN_CLASS = {
  key: 'text-foreground',
  str: 'text-[var(--syntax-string)]',
  num: 'text-[var(--syntax-number)]',
  lit: 'text-[var(--syntax-keyword)]',
} as const;

function Highlighted({ text }: { text: string }) {
  return <>{highlightTokens(text).map((tok, i) =>
    tok.kind === 'plain' ? tok.text : <span key={i} className={TOKEN_CLASS[tok.kind]}>{tok.text}</span>)}</>;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const label = copied ? t('Copied') : t('Copy');
  return (
    <button type="button" aria-label={label} title={label}
      onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined); }}
      className={cn(
        'grid size-7 place-items-center rounded-[var(--radius-xs)] bg-card shadow-[0_0_0_0.5px_var(--border-subtle)] transition-colors hover:bg-muted/40',
        copied ? 'text-[var(--accent-default)]' : 'text-muted-foreground hover:text-foreground',
      )}>
      {copied ? <Check size={14} className="animate-fade-in" /> : <Copy size={14} />}
    </button>
  );
}

/** Live ms while running, the final value after. With accumulate, several
 *  running stretches add up (a pause before a retry). */
function useStopwatch(running: boolean, startedAt: number | undefined, accumulate: boolean) {
  const start = useRef<number | null>(null);
  const base = useRef(0);
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    if (!running) {
      if (start.current !== null) {
        base.current += Date.now() - start.current;
        start.current = null;
        setMs(base.current);
      }
      return;
    }
    if (!accumulate) base.current = 0;
    start.current = startedAt ?? Date.now();
    const tick = () => setMs(base.current + Date.now() - (start.current ?? Date.now()));
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [running, startedAt, accumulate]);
  return ms;
}
