'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, Check, CheckCheck, ChevronRight, Copy, FileText, Hand, Loader2, Pencil, RotateCcw } from '@/ui/icons';
import { formatAge } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import type { CopilotApproval, CopilotApprovalCall, CopilotAttachment, CopilotMessage, ToolEvent } from './useAlconCopilot';
import { CRITICAL_CLASS_LABELS } from '@/AIP/connectors/catalog';
import { toolVerb } from './copilotFiles';
import { splitAnswer } from './chartSpec';

const ChatChart = dynamic(() => import('./ChatChart'), { ssr: false, loading: () => <div className="h-52 rounded-lg border border-border/60" /> });

/** One turn of the conversation. The AI's answer is Markdown, rendered — no
 *  bare asterisks; its work shows as steps above it. Under each turn, as in
 *  Claude's chat: copy, and on the latest exchange retry (an answer) or edit
 *  (a question); the time shows beside them. */
export function CopilotMessageView({ message, streaming, onRetry, onEdit, onDecideApproval }: {
  message: CopilotMessage;
  streaming: boolean;
  /** Present on the latest answer once it is in. */
  onRetry?: () => void;
  /** Present on the latest question while nothing is streaming. */
  onEdit?: () => void;
  /** Present when an approval card on this answer can be decided now. */
  onDecideApproval?: (approval: CopilotApproval, approve: boolean) => void;
}) {
  const { t } = useI18n();
  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1 animate-fade-in">
        {message.attachments?.length ? <AttachmentChips files={message.attachments} /> : null}
        {message.content && (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-primary/20 bg-primary/15 px-2.5 py-1.5 text-foreground">
            {message.content}
          </div>
        )}
        {/* The latest question keeps its row in view; earlier ones show it on hover. */}
        <div className={`flex items-center gap-0.5 transition-opacity ${onEdit ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
          <CheckCheck size={12} className="text-muted-foreground/70" aria-label={t('Sent')} />
          {message.at != null && <span className="px-1 text-[11px] text-muted-foreground/70">{formatAge(new Date(message.at), true)}</span>}
          {message.content && <CopyButton text={message.content} />}
          {onEdit && <ActionButton label={t('Edit')} onClick={onEdit}><Pencil size={12} /></ActionButton>}
        </div>
      </div>
    );
  }
  const events = message.toolEvents ?? [];
  const settled = message.done && !streaming;
  return (
    <div className="group space-y-1.5">
      {events.length > 0 && <ToolSteps events={events} live={streaming} answered={!!message.content} />}
      {message.content
        ? <Answer content={message.content} />
        : streaming && events.length === 0 && <Working label="Thinking" />}
      {message.approvals?.map((a) => (
        <ApprovalCard key={a.inputHash} approval={a}
          onDecide={onDecideApproval ? (approve) => onDecideApproval(a, approve) : undefined} />
      ))}
      {settled && message.content && (
        <div className={`flex items-center gap-0.5 transition-opacity ${onRetry ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
          <CopyButton text={message.content} />
          {onRetry && <ActionButton label={t('Retry')} onClick={onRetry}><RotateCcw size={12} /></ActionButton>}
          {message.at != null && <span className="pl-1 text-[11px] text-muted-foreground/70">{formatAge(new Date(message.at), true)}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Integration writes waiting for the person's decision, on a card in the
 * chat: the same contract as a run's approval card — the operations and
 * where they go, a critical warning, the calls bound to exactly this
 * input — at the panel's size. Approving runs exactly these calls with
 * exactly this input; denying runs nothing. A persisted card (one with a
 * run and an action) is a run's approval like any other: it waits in the
 * Inbox too, for the person who started the conversation, and lapses
 * after seven days undecided.
 */
function ApprovalCard({ approval, onDecide }: {
  approval: CopilotApproval;
  /** Absent while a turn is streaming, or on a surface that cannot decide. */
  onDecide?: (approve: boolean) => void;
}) {
  const { t } = useI18n();
  const [showInput, setShowInput] = useState(false);
  const calls = approval.calls;
  const critical = calls.find((c) => c.display.critical)?.display.critical ?? null;
  const destinations = [...new Set(calls.map((c) => c.display.destination).filter(Boolean))];
  const groups = new Map<string, number>();
  for (const c of calls) {
    const key = `${c.display.integration} · ${c.display.operation || t('write')}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const summary = [...groups.entries()].map(([k, n]) => (n > 1 ? `${k} × ${n}` : k)).join('、');
  const status = approval.status;
  return (
    <div className="rounded-lg border border-border bg-card p-2.5 animate-fade-in">
      <div className="flex items-start gap-2">
        <Hand size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground">{summary}</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {calls.length > 1 ? `${t('Approving runs all {n} operations', { n: calls.length })} · ` : ''}
            {destinations.length === 1 ? t('Destination: {where}', { where: destinations[0] }) : t('{n} destinations', { n: destinations.length })}
          </div>
        </div>
        {status === 'pending' && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{t('Awaiting approval')}</span>
        )}
      </div>

      {critical && (
        <div className="mt-2 rounded-md border border-[var(--status-danger)]/40 bg-[var(--status-danger)]/10 px-2 py-1.5 text-[11.5px] text-[var(--status-danger)]">
          {t('This includes a critical operation ({class}). Critical operations always ask, whatever the delegation.', { class: t(CRITICAL_CLASS_LABELS[critical as keyof typeof CRITICAL_CLASS_LABELS] ?? critical) })}
        </div>
      )}

      <ul className="mt-2 space-y-1.5">
        {calls.map((c) => <ApprovalCallRow key={c.id} call={c} />)}
      </ul>

      <button type="button" onClick={() => setShowInput((v) => !v)} aria-expanded={showInput}
        className="mt-2 flex items-center gap-1 rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight size={11} className={`transition-transform duration-200 ${showInput ? 'rotate-90' : ''}`} />
        {t('Exact input')}
      </button>
      {showInput && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 font-mono text-[10.5px] text-muted-foreground animate-fade-in">
          {JSON.stringify(calls.map((c) => c.input), null, 2)}
        </pre>
      )}
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {t('Allowing runs exactly these calls with exactly this input. If the input changes, this approval no longer matches.')}
      </div>

      {status === 'pending' && onDecide && (
        <div className="mt-2.5 flex items-center justify-end gap-1.5">
          <button type="button" onClick={() => onDecide(false)}
            className="rounded-md border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-muted">
            {t('Deny')}
          </button>
          <button type="button" onClick={() => onDecide(true)}
            className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
            {t('Approve and run')}
          </button>
        </div>
      )}
      {status === 'executing' && <div className="mt-2"><Working label="Working" /></div>}
      {status === 'denied' && (
        <div className="mt-2 text-[11.5px] text-muted-foreground">{t('You denied this operation. It was not run.')}</div>
      )}
      {status === 'expired' && (
        <div className="mt-2 text-[11.5px] text-muted-foreground">{t('This approval expired undecided. It was not run.')}</div>
      )}
      {(status === 'executed' || status === 'failed') && approval.results && (
        <ul className="mt-2 space-y-0.5">
          {approval.results.map((r, i) => {
            const call = calls.find((c) => c.name === r.name);
            const Icon = r.ok ? Check : AlertCircle;
            return (
              <li key={i} className={`flex min-w-0 items-start gap-1.5 text-[11.5px] ${r.ok ? 'text-muted-foreground' : 'text-[var(--status-danger)]'}`}>
                <Icon size={11} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  {call && <span className="font-medium">{call.display.integration} · {call.display.operation} — </span>}
                  <span className="break-words">{r.content.slice(0, 160)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ApprovalCallRow({ call }: { call: CopilotApprovalCall }) {
  const { t } = useI18n();
  const d = call.display;
  const fields = Object.entries(call.input).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 6);
  return (
    <li className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-medium text-foreground">{d.integration}</span>
        <span className="rounded bg-background px-1 py-px font-mono text-[10.5px] text-muted-foreground">{d.operation}</span>
        <span className="text-[10.5px] text-muted-foreground">{d.effect === 'read' ? t('read') : t('write')}</span>
        {d.critical && (
          <span className="rounded border border-[var(--status-danger)]/40 px-1 py-px text-[10.5px] text-[var(--status-danger)]">
            {t('Critical · {class} — always asks', { class: t(CRITICAL_CLASS_LABELS[d.critical as keyof typeof CRITICAL_CLASS_LABELS] ?? d.critical) })}
          </span>
        )}
      </div>
      {d.detail && <div className="mt-0.5 break-all font-mono text-[10.5px] text-muted-foreground">{d.detail}</div>}
      {fields.length > 0 && (
        <div className="mt-0.5 space-y-px">
          {fields.map(([k, v]) => (
            <div key={k} className="flex min-w-0 gap-1.5 text-[11px]">
              <span className="shrink-0 text-muted-foreground">{k}</span>
              <span className="truncate text-foreground/90">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}

/** Copies the text as written (Markdown for an answer); a check confirms it. */
function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <ActionButton label={t(copied ? 'Copied' : 'Copy')} onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}>
      {copied ? <Check size={12} className="animate-scale-in" /> : <Copy size={12} />}
    </ActionButton>
  );
}

/** The answer's prose as Markdown, with any chart blocks drawn as charts. */
function Answer({ content }: { content: string }) {
  const parts = useMemo(() => splitAnswer(content), [content]);
  return (
    <div className="space-y-2">
      {parts.map((p, i) => p.kind === 'text'
        ? <MarkdownLite key={i} text={p.text} className="break-words text-foreground/95" />
        : p.kind === 'chart'
          ? <ChatChart key={i} spec={p.spec} />
          : <div key={i} className="h-52 rounded-lg border border-border/60 animate-pulse" />)}
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
        <span>{events.length === 1 ? t('1 step') : t('{n} steps', { n: events.length })}</span>
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
