'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ChevronRight, Globe, ListChecks, Loader2, PenLine, Search,
} from '@/ui/icons';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { SendIcon } from '@/Function/shared/SendIcon';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { useStrategyConversation } from '@/hooks/strategyConversationData';
import type { ElementWithDetails } from '@/types/database';
import { conversationItems, workTally, type AgentSegment, type WorkItem } from './conversationModel';

// =============================================================
// The Strategy's conversation tab: the person and the agent engine settle
// the abstract part — purpose, success conditions, premises, decisions, how
// the work is carried out — and the engine writes each to the Strategy as it
// is agreed. The breakdown stays the Planner's: the conversation hands it
// over ("Draft the plan"), and the plan card at the foot shows the
// Strategy's Elements as they are made and done. A Strategy that is already
// clear goes straight to the Planner from that card or the Execution tab.
// =============================================================

const WORK_LABEL: Record<string, string> = {
  updateInitiative: 'Updated the purpose',
  createInitiative: 'Added a Sub Strategy',
  addIntent: 'Recorded',
  updateIntent: 'Revised',
  removeIntent: 'Removed',
  writeInitiativeDefinition: 'Wrote the harness',
  getInitiative: 'Read the Strategy',
  listInitiatives: 'Listed Strategies',
  hand_to_planner: 'Handed to the Planner',
  web_search: 'Searched the web',
  web_fetch: 'Read a page',
};

export function StrategyConversation({ strategyId, objects, onPlan, onAnswered }: {
  strategyId: string;
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
          : <AgentTurn key={i} segments={item.segments} onPlan={onPlan} />)}
        {talk.pendingText && !items.some((it, i) => i === items.length - 1 && it.kind === 'person' && it.text === talk.pendingText) && (
          <PersonTurn text={talk.pendingText} />
        )}
        {talk.working && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />{t('Thinking…')}
          </div>
        )}
        {(talk.error || stopped) && (
          <p role="alert" className="text-[12px] text-[var(--status-danger)]">{talk.error ?? stopped}</p>
        )}
      </div>

      <PlanCard objects={objects} onPlan={() => onPlan('')} />

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
        <Button type="submit" variant="primary" size="xs" disabled={!input.trim() || talk.working} aria-label={t('Send')} className="mb-0.5 rounded-md px-2">
          <SendIcon size={13} />
        </Button>
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

function AgentTurn({ segments, onPlan }: { segments: AgentSegment[]; onPlan: (guidance: string) => void }) {
  return (
    <div className="space-y-2">
      {segments.map((s, i) => s.kind === 'text'
        ? <MarkdownLite key={i} text={s.text} className="text-[13px] leading-relaxed text-foreground" />
        : (
          <div key={i} className="space-y-2">
            <WorkLine items={s.items} />
            {s.items.filter((w) => w.kind === 'plan').map((w) => <PlanHandOff key={w.id} guidance={w.detail} onPlan={onPlan} />)}
          </div>
        ))}
    </div>
  );
}

/** The agent's work between its words, folded to one line that opens to the list. */
function WorkLine({ items }: { items: WorkItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const tally = workTally(items);
  const parts = [
    tally.write ? t('Wrote {n} to the Strategy', { n: tally.write }) : '',
    tally.read ? t('Read {n}', { n: tally.read }) : '',
    tally.web ? t('Searched the web {n}', { n: tally.web }) : '',
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
        <ul className="mt-1.5 space-y-1 border-l border-border/60 pl-3">
          {items.map((w) => (
            <li key={w.id} className="flex min-w-0 items-start gap-1.5">
              <WorkIcon item={w} />
              <span className="min-w-0">
                <span className="text-foreground">{t(WORK_LABEL[w.name] ?? w.name)}</span>
                {w.detail && <span className="ml-1.5">{w.detail}</span>}
                {w.error && <span className="block text-[var(--status-danger)]">{w.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkIcon({ item }: { item: WorkItem }) {
  if (item.ok === false) return <AlertCircle size={12} className="mt-0.5 shrink-0 text-[var(--status-danger)]" />;
  if (item.ok === undefined) return <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />;
  const Icon = item.kind === 'write' ? PenLine : item.kind === 'web' ? Globe : item.kind === 'plan' ? ListChecks : Search;
  return <Icon size={12} className="mt-0.5 shrink-0" />;
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
