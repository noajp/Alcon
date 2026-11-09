'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, Check, CheckCheck, ChevronRight, Copy, FileText, Loader2, Pencil, RotateCcw } from '@/ui/icons';
import { formatAge } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import type { AgentAction } from '@/types/database';
import type { CopilotApproval, CopilotAttachment, CopilotConnectionProposal, CopilotCredentialAsk, CopilotMessage, ToolEvent } from './useAlconCopilot';
import { toolVerb } from './copilotFiles';
import { splitAnswer } from './chartSpec';
import { CHART_CARD_CLASS } from './chartColors';
import { ConnectRequestCard } from '@/AIP/connectors/ConnectRequestCard';
import { CredentialRequestCard } from '@/AIP/connectors/CredentialRequestCard';
import { missingConnectors } from '@/AIP/harness/installFlow';
import { useIntegrations } from '@/AIP/connectors/data';

const ChatChart = dynamic(() => import('./ChatChart'), { ssr: false, loading: () => <div className={`h-52 ${CHART_CARD_CLASS}`} /> });

/** One turn of the conversation. The AI's answer is Markdown, rendered — no
 *  bare asterisks; its work shows as steps above it. Under each turn, as in
 *  Claude's chat: copy, and on the latest exchange retry (an answer) or edit
 *  (a question); the time shows beside them. */
export function CopilotMessageView({ message, streaming, onRetry, onEdit, onDecideApproval, canRememberApproval, spaceId, onContinueConnection, onContinueCredential, onChartColors }: {
  message: CopilotMessage;
  streaming: boolean;
  /** Present on the latest answer once it is in. */
  onRetry?: () => void;
  /** Records the person's chart colors on this answer (chart ordinal
   *  → the chart's whole next override record). Offered to the charts
   *  only once the message is settled. */
  onChartColors?: (chartIndex: number, colors: Record<string, string>) => void;
  /** Present on the latest question while nothing is streaming. */
  onEdit?: () => void;
  /** Present when an approval card on this answer can be decided now. */
  onDecideApproval?: (approval: CopilotApproval, approve: boolean, opts: { note?: string; remember?: string[] }) => void;
  /** Whether the viewer owns the Space (a standing approval is theirs to give). */
  canRememberApproval?: boolean;
  /** The conversation's Space — what a connection proposal's card reads and opens against. */
  spaceId?: string | null;
  /** Continue the work a connection proposal was waiting on (person-pressed). */
  onContinueConnection?: (proposal: CopilotConnectionProposal) => void;
  /** Continue the work a credential capture was waiting on (person-pressed). */
  onContinueCredential?: (ask: CopilotCredentialAsk) => void;
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
        ? <Answer content={message.content} chartColors={message.chartColors} settled={settled}
            onChartColors={settled ? onChartColors : undefined} />
        : streaming && events.length === 0 && <Working label="Thinking" />}
      {message.approvals?.map((a) => (
        <ApprovalCard key={a.inputHash} approval={a} canRemember={canRememberApproval}
          onDecide={onDecideApproval ? (approve, opts) => onDecideApproval(a, approve, opts) : undefined} />
      ))}
      {message.connections?.map((c, i) => (
        <ConnectProposalCard key={i} spaceId={spaceId ?? null} proposal={c}
          onContinue={onContinueConnection ? () => onContinueConnection(c) : undefined} />
      ))}
      {message.credentials?.map((c) => (
        <CredentialRequestCard key={c.requestId} spaceId={spaceId ?? null} requestId={c.requestId} label={c.label}
          onContinue={onContinueCredential ? () => onContinueCredential(c) : undefined} />
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
 * A connection the turn proposed, as the same card the Strategy
 * conversation shows: the needs are re-read from the Space's live
 * connections (a name connected since drops off; one whose latest test
 * failed stays, as a reauth), and connecting happens in the dialog the
 * card opens — the person's act, as everywhere. Once everything asked
 * for is connected, the card offers to continue the waiting work; the
 * resume itself is the person's button press, so it never fires on a
 * connection made for another reason.
 */
function ConnectProposalCard({ spaceId, proposal, onContinue }: {
  spaceId: string | null;
  proposal: CopilotConnectionProposal;
  onContinue?: () => void;
}) {
  const integrations = useIntegrations(spaceId);
  const needs = useMemo(() => {
    const still = missingConnectors(proposal.names, integrations.data);
    return proposal.names.map((name) => still.find((n) => n.name === name) ?? { name, preset: null, kind: 'missing' as const });
  }, [integrations.data, proposal.names]);
  return (
    <ConnectRequestCard spaceId={spaceId} needs={needs} waitingFor={proposal.waitingFor || null}
      onContinue={onContinue} />
  );
}

/**
 * Integration writes waiting for the person's decision, on a card in the
 * chat: the shared decision card (Function/shared/ApprovalDecisionCard),
 * fed by an action-shaped view of the turn payload — the same contract
 * as a run's approval card. Approving runs exactly these calls with
 * exactly this input; denying runs nothing. A persisted card (one with a
 * run and an action) is a run's approval like any other: it waits in the
 * Inbox too, for the person who started the conversation, and lapses
 * after seven days undecided. The chat's own addition over the shared
 * anatomy is the per-call results, which land on the card once its
 * approved calls have run.
 */
function ApprovalCard({ approval, onDecide, canRemember }: {
  approval: CopilotApproval;
  /** Absent while a turn is streaming, or on a surface that cannot decide. */
  onDecide?: (approve: boolean, opts: { note?: string; remember?: string[] }) => void;
  canRemember?: boolean;
}) {
  const { t } = useI18n();
  const action = useMemo<AgentAction>(() => {
    // The grouped summary the chat card has always headlined a mixed
    // batch with; a uniform batch's headline comes from the model.
    const groups = new Map<string, number>();
    for (const c of approval.calls) {
      const key = `${c.display.integration} · ${c.display.operation || t('write')}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const summary = [...groups.entries()].map(([k, n]) => (n > 1 ? `${k} × ${n}` : k)).join('、');
    return {
      id: approval.actionId ?? approval.inputHash,
      run_id: approval.runId ?? '',
      element_id: null,
      tool: '',
      input: {
        calls: approval.calls.map((c) => ({ id: c.id, name: c.name, input: c.input })),
        display: approval.calls.map((c) => ({ ...c.display, id: c.id })),
      } as AgentAction['input'],
      input_hash: approval.inputHash,
      summary,
      integration_id: null,
      status: approval.status === 'pending' ? 'pending'
        : approval.status === 'executing' ? 'approved'
        : approval.status === 'executed' ? 'executed'
        : approval.status === 'denied' ? 'rejected'
        : approval.status === 'failed' ? 'failed' : 'expired',
      decided_by: null,
      decided_at: null,
      decision_note: null,
      result: null,
      expires_at: null,
      created_at: '',
    };
  }, [approval, t]);
  return (
    <ApprovalDecisionCard action={action} surface="chat"
      canDecide={!!onDecide} canRemember={canRemember} results={approval.results}
      onDecide={async (approve, opts) => { onDecide?.(approve, opts); }} />
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

/** The answer's prose as Markdown, with any chart blocks drawn as charts.
 *  Charts are counted as they are met: a chart's ordinal in the message
 *  keys the person's colors on it (chartColors), the same index the
 *  message is rendered by. */
function Answer({ content, chartColors, settled, onChartColors }: {
  content: string;
  chartColors?: Record<number, Record<string, string>>;
  /** The message is settled: its charts show their toolbars. */
  settled?: boolean;
  /** Present on a settled answer the person may recolor. */
  onChartColors?: (chartIndex: number, colors: Record<string, string>) => void;
}) {
  const parts = useMemo(() => splitAnswer(content), [content]);
  // Each chart part's ordinal among the message's charts (-1 for prose).
  const ordinals = useMemo(() => {
    let n = 0;
    return parts.map((p) => (p.kind === 'chart' ? n++ : -1));
  }, [parts]);
  return (
    <div className="space-y-2">
      {parts.map((p, i) => p.kind === 'text'
        ? <MarkdownLite key={i} text={p.text} className="break-words text-foreground/95" />
        : p.kind === 'chart'
          ? <ChatChart key={i} spec={p.spec} colors={chartColors?.[ordinals[i]]} interactive={settled}
              onColorsChange={onChartColors ? (next) => onChartColors(ordinals[i], next) : undefined} />
          : <div key={i} className={`h-52 ${CHART_CARD_CLASS} animate-pulse`} />)}
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
