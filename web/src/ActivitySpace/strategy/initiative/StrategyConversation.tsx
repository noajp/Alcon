'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight, ListChecks, MessageSquare, Play, Square,
} from '@/ui/icons';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { SendIcon } from '@/Function/shared/SendIcon';
import { ThinkingTrace } from '@/Function/shared/ThinkingTrace';
import { TraceStepList } from '@/Function/shared/workTraceView';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { useStrategyConversation } from '@/hooks/strategyConversationData';
import { useLatestRunStatuses } from '@/hooks/elementRunData';
import { useDefinitions } from '@/hooks/definitionData';
import { useIntegrations } from '@/AIP/connectors/data';
import { ConnectRequestCard } from '@/AIP/connectors/ConnectRequestCard';
import { CredentialRequestCard } from '@/AIP/connectors/CredentialRequestCard';
import { CredentialChatHint } from '@/AIP/connectors/CredentialChatHint';
import { useIntegrationDrafts } from '@/AIP/connectors/draftData';
import { openDraftForName } from '@/AIP/connectors/draftModel';
import { missingConnectors, missingForWork, type ConnectorNeed } from '@/AIP/harness/installFlow';
import { answerAgentRun, startElementRun } from '@/AIP/ai/agentData';
import type { AgentRunStatus, ElementWithDetails, IntegrationDraft, IntegrationDraftStatus } from '@/types/database';
import { conversationItems, traceStepFromWorkItem, workTally, type AgentSegment, type WorkItem } from './conversationModel';

// =============================================================
// The Strategy's conversation tab: the person and the agent engine settle
// the abstract part — purpose, success conditions, premises, decisions, how
// the work is carried out — and the engine writes each to the Strategy as it
// is agreed. The breakdown stays the Planner's: the conversation hands it
// over ("Draft the plan"), and the plan card at the foot shows the
// Strategy's Elements as they are made and done. A Strategy that is already
// clear goes straight to the Planner from that card or the Execution tab.
// =============================================================

export function StrategyConversation({ strategyId, spaceId, strategyDefinitionId, objects, onPlan, onAnswered }: {
  strategyId: string;
  /** The Strategy's Space: its connections and harnesses are read from it. */
  spaceId: string | null;
  /** The Strategy's own harness, for resolving what an Element's work follows. */
  strategyDefinitionId: string | null;
  /** The Strategy's Objects with their Elements: the plan card's checklist. */
  objects: { id: string; name: string; elements?: ElementWithDetails[] }[];
  /** Draft the plan in the Execution tab, with this guidance. */
  onPlan: (guidance: string) => void;
  /** An answer landed: re-read what it may have written. */
  onAnswered: () => void;
}) {
  const { t } = useI18n();
  const talk = useStrategyConversation(strategyId, onAnswered);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => conversationItems(talk.steps), [talk.steps]);
  // The capture asks this conversation carries: while one stands,
  // the composer says the password belongs in its card (PR4).
  const credentialRequestIds = useMemo(() => items.flatMap((item) => item.kind === 'agent'
    ? item.segments.flatMap((s) => s.kind === 'work'
      ? s.items.flatMap((w) => (w.proposal?.kind === 'credential' ? [w.proposal.requestId] : []))
      : [])
    : []), [items]);
  // For the proposal cards' revalidation: the Elements as they stand now,
  // and each one's latest run — a proposal is only as fresh as its press.
  const elementIds = useMemo(() => objects.flatMap((o) => (o.elements ?? []).map((e) => e.id)), [objects]);
  const elementStatus = useMemo(
    () => new Map(objects.flatMap((o) => (o.elements ?? []).map((e) => [e.id, e.status] as const))),
    [objects],
  );
  const { data: runStatuses } = useLatestRunStatuses(elementIds);
  // What each Element's work would go without: the connectors its harness
  // (its own, else this Strategy's — the engine's resolution) names that
  // the Space has not connected. Read live, so a start card and a
  // connection card agree with the moment they are pressed, not proposed.
  const integrations = useIntegrations(spaceId);
  // The Space's AI drafts (G4), read live like the connections: a start
  // card waiting on a name with a draft in flight says where it stands.
  const drafts = useIntegrationDrafts(spaceId);
  const definitions = useDefinitions(spaceId);
  const missingByElement = useMemo(() => {
    const out = new Map<string, ConnectorNeed[]>();
    for (const o of objects) {
      for (const e of o.elements ?? []) {
        const missing = missingForWork([e.definition_id, strategyDefinitionId], definitions.data, integrations.data);
        if (missing.length) out.set(e.id, missing);
      }
    }
    return out;
  }, [objects, strategyDefinitionId, definitions.data, integrations.data]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, talk.working, talk.pendingText]);

  const submit = (text = input) => {
    if (!text.trim() || talk.working) return;
    setInput('');
    void talk.send(text);
  };

  const starters = [
    t('Let’s start from the purpose'),
    t('Ask me what is missing in the record'),
    t('Write how the work should be carried out'),
  ];
  const empty = items.length === 0 && !talk.pendingText;
  const stopped = talk.run && (talk.run.status === 'paused' || talk.run.status === 'failed') ? talk.run.error : null;
  // A person's stop: the run's error is null, so the line says the
  // state itself, quietly — not an empty alert.
  const cancelled = talk.run?.status === 'cancelled';

  return (
    <div className="flex flex-col gap-4">
      <div ref={listRef} className="space-y-5">
        {empty && !talk.loading && (
          <div className="space-y-3 rounded-lg border border-border/60 px-4 py-4">
            <p className="text-[13px] text-foreground">{t('Settle what this Strategy is for by talking it through. What is agreed is written to the Strategy — purpose, success conditions, premises, decisions and how the work is done — and the Planner breaks it down from there.')}</p>
            <p className="text-[12px] text-muted-foreground">{t('If it is already clear, go straight to the plan below.')}</p>
            <div className="flex flex-wrap gap-1.5">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => submit(s)} disabled={talk.working}
                  className="rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item, i) => item.kind === 'person'
          ? <PersonTurn key={i} text={item.text} />
          : <AgentTurn key={i} segments={item.segments} onPlan={onPlan} onAnswered={onAnswered} elementStatus={elementStatus} runStatuses={runStatuses} spaceId={spaceId} missingByElement={missingByElement} integrations={integrations.data} drafts={drafts.data} />)}
        {talk.pendingText && !items.some((it, i) => i === items.length - 1 && it.kind === 'person' && it.text === talk.pendingText) && (
          <PersonTurn text={talk.pendingText} />
        )}
        <ThinkingTrace working={talk.working} />
        {(talk.error || stopped) && (
          <p role="alert" className="text-[12px] text-[var(--status-danger)]">{talk.error ?? stopped}</p>
        )}
        {!talk.error && !stopped && cancelled && (
          <p className="text-[12px] text-muted-foreground">{t('Stopped')}</p>
        )}
      </div>

      <PlanCard objects={objects} onPlan={() => onPlan('')} />

      <CredentialChatHint requestIds={credentialRequestIds} />
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="flex items-end gap-1.5 rounded-lg border border-border/40 bg-[var(--surface-rail)] px-2 py-1.5 shadow-[var(--shadow-island)] focus-within:border-border">
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          rows={1}
          placeholder={talk.working ? t('Answering…') : t('Talk about the purpose, what success looks like, or what worries you')}
          aria-label={t('Message about this Strategy')}
          className="max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent px-1 py-1 text-[13px] leading-[1.5] outline-none"
        />
        {talk.run && !talk.working && (
          <Button type="button" variant="ghost" size="xs" onClick={talk.startOver} title={t('Start a new conversation')}>
            {t('New conversation')}
          </Button>
        )}
        {talk.working ? (
          // While the engine answers, the composer's action is Stop —
          // the Copilot panel's pattern (Square, the same word) — not
          // a Send that merely sits disabled.
          <Button type="button" variant="ghost" size="xs" onClick={() => void talk.stop()} title={t('Stop')} aria-label={t('Stop')} className="mb-0.5">
            <Square size={13} />
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="xs" disabled={!input.trim()} aria-label={t('Send')} className="mb-0.5 rounded-md px-2">
            <SendIcon size={13} />
          </Button>
        )}
      </form>
    </div>
  );
}

function PersonTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-[var(--surface-strong)] px-3.5 py-2.5 text-[13px] text-foreground">{text}</div>
    </div>
  );
}

function AgentTurn({ segments, onPlan, onAnswered, elementStatus, runStatuses, spaceId, missingByElement, integrations, drafts }: {
  segments: AgentSegment[];
  onPlan: (guidance: string) => void;
  onAnswered: () => void;
  elementStatus: Map<string, string | null>;
  runStatuses: Record<string, AgentRunStatus>;
  spaceId: string | null;
  missingByElement: Map<string, ConnectorNeed[]>;
  integrations: Parameters<typeof missingConnectors>[1];
  drafts: readonly IntegrationDraft[];
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-muted-foreground">{t('Athena')}</div>
      {segments.map((s, i) => s.kind === 'text'
        ? <MarkdownLite key={i} text={s.text} className="text-[13px] leading-relaxed text-foreground" />
        : (
          <div key={i} className="space-y-2">
            <WorkLine items={s.items} />
            {s.items.filter((w) => w.kind === 'plan').map((w) => <PlanHandOff key={w.id} guidance={w.detail} onPlan={onPlan} />)}
            {s.items.filter((w) => w.proposal?.kind === 'start').map((w) => (
              <StartRunsCard key={w.id} item={w} elementStatus={elementStatus} runStatuses={runStatuses} spaceId={spaceId} missingByElement={missingByElement} drafts={drafts} />
            ))}
            {s.items.filter((w) => w.proposal?.kind === 'answer').map((w) => (
              <AnswerCard key={w.id} item={w} onAnswered={onAnswered} />
            ))}
            {s.items.filter((w) => w.proposal?.kind === 'connect').map((w) => (
              <ConnectCard key={w.id} item={w} spaceId={spaceId} integrations={integrations} />
            ))}
            {s.items.filter((w) => w.proposal?.kind === 'credential').map((w) => (
              <CredentialCard key={w.id} item={w} spaceId={spaceId} />
            ))}
          </div>
        ))}
    </div>
  );
}

/** The agent's work between its words, folded to one line that opens to
 *  the list — the tally sentence is the conversation's own; the rows under
 *  it are the shared trace steps every run shows. */
function WorkLine({ items }: { items: WorkItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tally = workTally(items);
  const parts = [
    tally.write ? t('Wrote {n} to the Strategy', { n: tally.write }) : '',
    tally.read ? t('Read {n}', { n: tally.read }) : '',
    tally.web ? t('Searched the web {n}', { n: tally.web }) : '',
    tally.start + tally.answer + tally.connect ? t('Proposed {n} actions', { n: tally.start + tally.answer + tally.connect }) : '',
    tally.failed ? t('{n} failed', { n: tally.failed }) : '',
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className="text-[12px] text-muted-foreground">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="inline-flex items-center gap-1 rounded px-0.5 hover:text-foreground">
        {parts.join(' · ')}
        <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-1.5 border-l border-border/60 pl-3">
          <TraceStepList steps={items.map(traceStepFromWorkItem)} />
        </div>
      )}
    </div>
  );
}

/** The agent handed the breakdown to the Planner: one press drafts it in the Execution tab. */
function PlanHandOff({ guidance, onPlan }: { guidance: string; onPlan: (guidance: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
      <ListChecks size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">{t('Ready to break this down into Objects and Elements')}</p>
        {guidance && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{guidance}</p>}
      </div>
      <Button size="sm" variant="primary" onClick={() => onPlan(guidance)}>{t('Draft the plan')}</Button>
    </div>
  );
}

/** Runs that mean an Element is already spoken for: it cannot be started. */
const OPEN_RUN: readonly AgentRunStatus[] = ['queued', 'running', 'awaiting_input', 'awaiting_approval', 'paused', 'awaiting_review'];

/** One waiting name's open AI draft (G4), in the connection card's
 *  voice: what the AI is doing with that name, or what the draft is
 *  waiting for. A status outside the open four says nothing. */
function DraftStateNote({ name, status }: { name: string; status: IntegrationDraftStatus }) {
  const { t } = useI18n();
  const line = status === 'drafting' ? t('The AI is drafting the {name} connection.', { name })
    : status === 'testing' ? t('The AI is testing the drafted {name} connection.', { name })
    : status === 'awaiting_review' ? t('The drafted {name} connection is waiting for review.', { name })
    : status === 'awaiting_input' ? t('The {name} draft is waiting for an answer.', { name })
    : null;
  if (!line) return null;
  return <p className="mt-0.5 text-[12px] text-muted-foreground">{line}</p>;
}

/** The agent proposed starting ready work: the person presses, and the web
 *  starts — revalidating at the press, since a proposal is only as fresh
 *  as when it was made. An Element starts only while it is still open and
 *  has no open run; each start is the Execution tab's own function.
 *
 *  An Element whose harness names a connector the Space has not connected
 *  does not start: starting it would run the work without the tools it
 *  was promised, quietly. It waits on the connection instead — the card
 *  says which connector, and the connection card under it opens the
 *  dialog. Once connected, the same Start press starts what waited. */
function StartRunsCard({ item, elementStatus, runStatuses, spaceId, missingByElement, drafts }: {
  item: WorkItem;
  elementStatus: Map<string, string | null>;
  runStatuses: Record<string, AgentRunStatus>;
  spaceId: string | null;
  missingByElement: Map<string, ConnectorNeed[]>;
  drafts: readonly IntegrationDraft[];
}) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startedIds, setStartedIds] = useState<ReadonlySet<string>>(new Set());
  const proposal = item.proposal;
  if (!proposal || proposal.kind !== 'start') return null;
  const blocked = proposal.elementIds.filter((id) => !startedIds.has(id) && (missingByElement.get(id)?.length ?? 0) > 0);
  const blockedNeeds = [...new Map(blocked.flatMap((id) => missingByElement.get(id) ?? []).map((n) => [n.name, n] as const)).values()];
  // A waiting name with a connection already being drafted for it: the
  // card says where that stands, not just that it waits. The draft is
  // read live, so the line moves as the draft does.
  const blockedDrafts = blockedNeeds.flatMap((n) => {
    const draft = openDraftForName(drafts, n.name);
    return draft ? [{ name: n.name, status: draft.status }] : [];
  });
  const blockedTitles = proposal.elementIds
    .map((id, i) => (blocked.includes(id) ? proposal.titles[i] : null))
    .filter((x): x is string => !!x);
  const startable = proposal.elementIds.filter((id) => !startedIds.has(id) && !blocked.includes(id));
  const press = async () => {
    setStarting(true);
    let started = 0;
    let failed = 0;
    const nowStarted = new Set(startedIds);
    for (const id of proposal.elementIds) {
      if (nowStarted.has(id) || blocked.includes(id)) continue;
      const status = elementStatus.get(id);
      const runStatus = runStatuses[id];
      if (status === undefined || status === 'done' || status === 'cancelled' || (runStatus && OPEN_RUN.includes(runStatus))) {
        failed += 1;
        continue;
      }
      if (await startElementRun(id) === 'failed') failed += 1;
      else { started += 1; nowStarted.add(id); }
    }
    setStartedIds(nowStarted);
    setOutcome([
      started ? t('Started {n} AI runs.', { n: started }) : '',
      failed ? t('{n} could not start', { n: failed }) : '',
      blocked.length ? t('{n} waiting on a connection', { n: blocked.length }) : '',
    ].filter(Boolean).join(' '));
    setStarting(false);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
        <Play size={15} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-foreground">{t('Start {n} ready actions with AI', { n: proposal.elementIds.length })}</p>
          {proposal.titles.length > 0 && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{proposal.titles.join('、')}</p>}
          {blocked.length > 0 && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {t('Waiting on a connection: {names}', { names: blockedNeeds.map((n) => n.name).join('、') })}
            </p>
          )}
          {blockedDrafts.map((d) => (
            <DraftStateNote key={d.name} name={d.name} status={d.status} />
          ))}
          {outcome && <p className="mt-0.5 text-[12px] text-muted-foreground">{outcome}</p>}
        </div>
        {startable.length > 0 && (
          <Button size="sm" variant="primary" disabled={starting} onClick={() => void press()}>{t('Start')}</Button>
        )}
      </div>
      {blocked.length > 0 && (
        <ConnectRequestCard spaceId={spaceId} needs={blockedNeeds}
          waitingFor={blockedTitles.length ? blockedTitles.join('、') : null} />
      )}
    </div>
  );
}

/** The agent proposed connecting what the work needs: the shared
 *  connection card, fed the ask's names. Which of them are still missing
 *  is read live — here each name becomes a need (its preset, when it is
 *  still missing), and the card itself re-reads the Space's connections
 *  before offering anything. */
function ConnectCard({ item, spaceId, integrations }: {
  item: WorkItem;
  spaceId: string | null;
  integrations: Parameters<typeof missingConnectors>[1];
}) {
  const proposal = item.proposal;
  if (!proposal || proposal.kind !== 'connect') return null;
  const stillMissing = missingConnectors(proposal.names, integrations);
  const needs = proposal.names.map((name) => stillMissing.find((n) => n.name === name) ?? { name, preset: null, kind: 'missing' as const });
  return <ConnectRequestCard spaceId={spaceId} needs={needs} waitingFor={proposal.waitingFor || null} />;
}

/** A credential capture the proposal created: the shared capture card,
 *  fed the request the step carries. The card re-reads its row live —
 *  the step is only the ask's address. No Continue here: this
 *  conversation is itself a run, and its continuation is the person's
 *  next message, as with the connect card on this surface. */
function CredentialCard({ item, spaceId }: { item: WorkItem; spaceId: string | null }) {
  const proposal = item.proposal;
  if (!proposal || proposal.kind !== 'credential') return null;
  return <CredentialRequestCard spaceId={spaceId} requestId={proposal.requestId} label={proposal.label} />;
}

/** The agent proposed delivering the person's words to a waiting run: the
 *  card shows the Element, the question it waits on, and the exact words;
 *  the person presses, and the web sends them as their message to the run. */
function AnswerCard({ item, onAnswered }: { item: WorkItem; onAnswered: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const proposal = item.proposal;
  if (!proposal || proposal.kind !== 'answer') return null;
  const press = async () => {
    setState('sending');
    try {
      await answerAgentRun(proposal.runId, proposal.text);
      setState('sent');
      onAnswered();
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
      <MessageSquare size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">{proposal.elementTitle}</p>
        {proposal.question && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{proposal.question}</p>}
        <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-foreground/90">{proposal.text}</p>
        {state === 'sent' && <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Answer sent')}</p>}
        {state === 'failed' && <p className="mt-0.5 text-[12px] text-[var(--status-danger)]">{t('Could not send the answer.')}</p>}
      </div>
      {state !== 'sent' && (
        <Button size="sm" variant="primary" disabled={state === 'sending'} onClick={() => void press()}>{t('Send answer')}</Button>
      )}
    </div>
  );
}

const DONE = new Set(['done']);

/** The plan as it stands: the Strategy's Elements by Object, checked off as
 *  they are done. Each Object is named once, over its own rows, never as a
 *  tag repeated on every row; the marks sit in one fixed column so every
 *  title starts at the same x. */
function PlanCard({ objects, onPlan }: { objects: { id: string; name: string; elements?: ElementWithDetails[] }[]; onPlan: () => void }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const groups = objects
    .map((o) => ({ id: o.id, name: o.name, rows: (o.elements ?? []).filter((e) => !e.parent_id && e.status !== 'cancelled') }))
    .filter((g) => g.rows.length > 0);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const done = groups.reduce((n, g) => n + g.rows.filter((e) => DONE.has(e.status ?? '')).length, 0);
  // Ten rows until asked for all, cut across the groups in order.
  const limit = all ? Infinity : 10;
  const shown = groups.map((g, i) => {
    const before = groups.slice(0, i).reduce((n, x) => n + x.rows.length, 0);
    return { ...g, rows: g.rows.slice(0, Math.max(0, limit - before)) };
  }).filter((g) => g.rows.length > 0);
  return (
    <section className="rounded-md border border-[var(--border-subtle)] px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium text-foreground">{t('Plan')}</span>
        {total > 0 && <span className="text-[12px] tabular-nums text-muted-foreground">{done}/{total}</span>}
        <div className="flex-1" />
        <Button size="xs" variant="ghost" onClick={onPlan}>{total ? t('Plan again') : t('Break down with AI')}</Button>
      </div>
      {total === 0 ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">{t('No plan yet. The Planner breaks the Strategy down into Objects and Elements from what is recorded.')}</p>
      ) : (
        <div className="mt-2 space-y-3">
          {shown.map((g) => (
            <div key={g.id}>
              <div className="flex h-6 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex w-4 shrink-0 justify-center"><ObjectIcon size={11} /></span>
                <span className="truncate">{g.name}</span>
              </div>
              <ul>
                {g.rows.map((e) => (
                  <li key={e.id} className="flex h-7 min-w-0 items-center gap-2 text-[13px]">
                    <span className="inline-flex w-4 shrink-0 justify-center"><ElementProgressMark status={e.status} progress={getElementProgress(e)} size={14} /></span>
                    <span className={cn('min-w-0 truncate', DONE.has(e.status ?? '') ? 'text-muted-foreground' : 'text-foreground')}>{e.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {total > 10 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="pl-6 text-[12px] text-muted-foreground hover:text-foreground">
              {all ? t('Show fewer') : t('Show all {count}', { count: total })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
