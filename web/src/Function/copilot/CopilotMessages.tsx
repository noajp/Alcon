'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import type { CopilotAttachment, CopilotMessage, ToolEvent } from './useAlconCopilot';
import { toolVerb } from './copilotFiles';

/** One turn of the conversation. The AI's answer is Markdown, rendered — no
 *  bare asterisks; its work shows as steps above it. */
export function CopilotMessageView({ message, streaming }: { message: CopilotMessage; streaming: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1 animate-fade-in">
        {message.attachments?.length ? <AttachmentChips files={message.attachments} /> : null}
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-primary/20 bg-primary/15 px-2.5 py-1.5 text-foreground">
            {message.content}
          </div>
        )}
      </div>
    );
  }
  const events = message.toolEvents ?? [];
  return (
    <div className="space-y-1.5">
      {events.length > 0 && <ToolSteps events={events} live={streaming} answered={!!message.content} />}
      {message.content
        ? <MarkdownLite text={message.content} className="break-words text-foreground/95" />
        : streaming && events.length === 0 && <Working label="Thinking" />}
    </div>
  );
}

export function AttachmentChips({ files, onRemove }: { files: CopilotAttachment[]; onRemove?: (index: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-1">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 py-0.5 pl-1.5 pr-1 text-[11.5px] text-foreground animate-scale-in">
          <FileText size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate" title={f.name}>{f.name}</span>
          {onRemove && (
            <button type="button" onClick={() => onRemove(i)} aria-label={t('Remove {name}', { name: f.name })}
              className="shrink-0 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground">×</button>
          )}
        </span>
      ))}
    </div>
  );
}

/** A still-running step: its label with light sweeping across, and how long
 *  it has been going. */
function Working({ label, since }: { label: string; since?: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5 text-[12px] animate-fade-in">
      <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />
      <span className="animate-shimmer">{t(label)}…</span>
      {since != null && <Elapsed since={since} />}
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 2) return null;
  return <span className="tabular-nums text-muted-foreground/70">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}

/**
 * The AI's work on the board, as steps. While it runs, the current step reads
 * live; once the answer is in, the steps fold into one line ("3 steps ▸")
 * that opens to show each, so the answer stays the thing to read.
 */
function ToolSteps({ events, live, answered }: { events: ToolEvent[]; live: boolean; answered: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // When this turn's steps began — the first render that saw them.
  const [started] = useState(() => Date.now());
  const running = live ? events.find((e) => !e.result) : undefined;
  const failed = events.filter((e) => e.result && !e.result.ok).length;
  return (
    <div className="text-[12px]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex items-center gap-1 rounded text-muted-foreground transition-colors hover:text-foreground">
        <span>{t('{n} steps', { n: events.length })}</span>
        {failed > 0 && <span className="text-[var(--status-danger)]">· {t('{n} failed', { n: failed })}</span>}
        <ChevronRight size={12} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 border-l border-border/60 pl-2.5 animate-fade-in">
          {events.map((e, i) => <StepRow key={i} event={e} />)}
        </ul>
      )}
      {running && <div className="mt-1"><Working label={toolVerb(running.name, running.input)} since={started} /></div>}
      {live && !running && !answered && <div className="mt-1"><Working label="Thinking" /></div>}
    </div>
  );
}

function StepRow({ event }: { event: ToolEvent }) {
  const { t } = useI18n();
  const r = event.result;
  const Icon = !r ? Loader2 : r.ok ? Check : AlertCircle;
  const tone = !r ? 'text-muted-foreground' : r.ok ? 'text-muted-foreground' : 'text-[var(--status-danger)]';
  const detail = r?.ok ? (r.rows != null ? t('{n} rows', { n: r.rows }) : null) : r?.error ?? null;
  return (
    <li className={`flex min-w-0 items-center gap-1.5 ${tone}`}>
      <Icon size={11} className={`shrink-0 ${!r ? 'animate-spin' : ''}`} />
      <span className="shrink-0">{t(toolVerb(event.name, event.input))}</span>
      <span className="truncate font-mono text-[11px] opacity-70">{event.name}</span>
      {detail && <span className="truncate opacity-80">· {detail}</span>}
    </li>
  );
}
