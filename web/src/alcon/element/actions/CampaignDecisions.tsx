'use client';

import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import {
  createIntent,
  deleteIntent,
  updateIntent,
  useStrategyIntentBundle,
} from '@/hooks/useSupabase';
import type { Intent } from '@/types/database';
import { Button } from '@/ui/button';
import { DateField } from '@/alcon/shared/date';
import { MenuShell, MENU_SEPARATOR } from '@/alcon/shared/menu';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { formatElementDate, fromDateOnlyString } from '@/alcon/shared/dateUtils';
import {
  countDueForReview,
  decisionStatusLabel,
  DECISION_STATUSES,
  isDueForReview,
  orderDecisions,
  reviewLabel,
  type Decision,
  type DecisionStatus,
} from '@/alcon/element/actions/campaignDecisionModel';

// =============================================================
// CampaignDecisions — where the choice gets written down.
//
// The sections above this one report how the Campaign is going. This one
// reports why it is going that way, and it is the only place in the app that
// keeps the two halves a decision is actually made of: the option that was
// taken, and the option that was thrown away to take it. A decision recorded as
// a comment on one Element keeps neither — the person reading the Campaign
// cannot see it, and the cost is gone the moment the thread scrolls.
//
// So every row states three things: what was chosen, what was given up, and the
// day the choice gets looked at again. The review day is the part that decays,
// which is why a decision whose day has passed is sorted to the top and says so
// rather than sitting quietly in date order.
// =============================================================

/** One `intents` row per decision, hung under the Campaign's root Intent.
 *  The table allows exactly one parent-less Intent per Campaign (a partial
 *  unique index), so the root is a spine rather than a decision: it is created
 *  on the first record, carries the Campaign's name, and is never listed. Every
 *  decision is its child, which also means deleting one cannot cascade into
 *  the others. */
export function CampaignDecisions({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const { data, error, refetch } = useStrategyIntentBundle(campaignId);

  // Written values, laid over the fetched rows. They are not cleared on
  // success — the value here *is* what the server now holds, so clearing it
  // before the refetch lands would flash the old status back. A failed write
  // puts the previous value back and surfaces the row again.
  const [edits, setEdits] = useState<Record<string, Partial<Intent>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [abandoned, setAbandoned] = useState('');
  const [horizon, setHorizon] = useState<string | null>(null);
  const [decidedBy, setDecidedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Memoises the root Intent's creation so two quick submits cannot both try to
  // insert one and lose the second to the unique index.
  const rootRef = useRef<Promise<string> | null>(null);

  const decisions = useMemo(() => {
    const rows = (data?.subs ?? [])
      .filter((i) => !removed.has(i.id))
      .map((i) => ({ ...i, ...edits[i.id] }));
    return orderDecisions(
      rows.map((i) => ({
        id: i.id,
        title: i.title,
        abandoned: i.abandoned ?? null,
        horizon: i.horizon ?? null,
        status: i.status ?? null,
        decidedBy: i.decided_by_name ?? null,
        decidedAt: i.decided_at ?? null,
        orderIndex: i.order_index ?? 0,
      })),
      new Date(),
    );
  }, [data?.subs, edits, removed]);

  const dueCount = countDueForReview(decisions);

  async function rootIntentId(): Promise<string> {
    if (data?.master) return data.master.id;
    if (!rootRef.current) {
      rootRef.current = createIntent({
        strategy_id: campaignId,
        parent_intent_id: null,
        title: campaignName,
        status: 'on_track',
        order_index: 0,
      })
        .then((intent) => intent.id)
        .catch((e) => {
          rootRef.current = null;
          throw e;
        });
    }
    return rootRef.current;
  }

  async function record() {
    const chosen = title.trim();
    if (!chosen || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const parent = await rootIntentId();
      await createIntent({
        strategy_id: campaignId,
        parent_intent_id: parent,
        title: chosen,
        abandoned: abandoned.trim() || null,
        horizon,
        decided_by_name: decidedBy.trim() || null,
        decided_at: new Date().toISOString(),
        status: 'on_track',
        order_index: (data?.subs.length ?? 0) + 1,
      });
      // The body clears, the recorder does not: writing up several calls from
      // one deliberation is a single sitting, and asking who decided them each
      // time is the part that gets abandoned first.
      setTitle('');
      setAbandoned('');
      setHorizon(null);
      refetch();
      titleRef.current?.focus();
    } catch (e) {
      console.error('record decision failed:', e);
      setFailure('Could not record the decision. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: DecisionStatus) {
    const previous = edits[id];
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], status } }));
    setFailure(null);
    try {
      await updateIntent(id, { status });
      refetch();
    } catch (e) {
      console.error('update decision status failed:', e);
      setEdits((prev) => {
        const next = { ...prev };
        if (previous) next[id] = previous;
        else delete next[id];
        return next;
      });
      setFailure('Could not change the status. The decision is unchanged.');
    }
  }

  async function remove(id: string) {
    setRemoved((prev) => new Set(prev).add(id));
    setFailure(null);
    try {
      await deleteIntent(id);
      refetch();
    } catch (e) {
      console.error('delete decision failed:', e);
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFailure('Could not delete the decision. It is still recorded.');
    }
  }

  function closeComposer() {
    setComposing(false);
    setSaving(false);
  }

  return (
    <section>
      <div className="h-px bg-border mb-3" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-medium text-foreground/90">Decisions</h2>
        <div className="flex items-center gap-2">
          {dueCount > 0 && (
            <span className="text-[11px] text-[var(--status-warning)] tabular-nums">
              {dueCount} due for review
            </span>
          )}
          {/* Held until the fetch lands: the root Intent is created only when
              this Campaign has none, and that is not known yet. Opening the
              composer early would let a submit race the answer and lose to the
              one-root-per-Campaign index. */}
          <button
            type="button"
            aria-label="Record a decision"
            disabled={!data}
            onClick={() => {
              setComposing(true);
              setFailure(null);
            }}
            className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {failure && (
        <p className="text-[12px] text-[var(--status-danger)] py-1">{failure}</p>
      )}

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)] py-1">
          Could not read this Campaign&apos;s decisions.
        </p>
      ) : !data ? (
        // Not `loading`: the hook reports false on the first render, before the
        // fetch it is about to start. Keying on the absence of the bundle keeps
        // "nothing decided here" from flashing over a Campaign that has a
        // decision record, which is the same lie as a fabricated zero.
        <p className="text-[12px] text-muted-foreground/50 py-1">Reading the record…</p>
      ) : decisions.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          Nothing decided here yet — record a call and what it cost, so the Campaign carries the
          reason and not just the result.
        </p>
      ) : (
        <div className="flex flex-col">
          {decisions.map((decision) => (
            <DecisionRow
              key={decision.id}
              decision={decision}
              onStatus={(status) => void setStatus(decision.id, status)}
              onDelete={() => void remove(decision.id)}
            />
          ))}
        </div>
      )}

      {composing && (
        <Composer
          titleRef={titleRef}
          title={title}
          abandoned={abandoned}
          horizon={horizon}
          decidedBy={decidedBy}
          saving={saving}
          onTitle={setTitle}
          onAbandoned={setAbandoned}
          onHorizon={setHorizon}
          onDecidedBy={setDecidedBy}
          onSubmit={() => void record()}
          onClose={closeComposer}
        />
      )}
    </section>
  );
}

// =============================================================
// A row. Three lines, because a decision has three parts and a one-line row
// can only hold the one that is least useful on its own.
// =============================================================
function DecisionRow({
  decision,
  onStatus,
  onDelete,
}: {
  decision: Decision;
  onStatus: (status: DecisionStatus) => void;
  onDelete: () => void;
}) {
  const decided = formatElementDate(decision.decidedAt);
  // `horizon` is a calendar day, so it is parsed from its parts. Handed to
  // `new Date()` whole it would be UTC midnight, and print as the day before
  // for every reader west of Greenwich.
  const horizonDay = formatElementDate(fromDateOnlyString(decision.horizon));

  return (
    <div className="group/row py-2 border-b border-border/40 last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          className="size-1.5 rounded-full shrink-0"
          style={{ background: statusVar(decision.status) }}
          aria-hidden
        />
        <span className="text-[13px] font-[550] text-foreground truncate min-w-0 flex-1">
          {decision.title}
        </span>
        <span className={`text-[11px] shrink-0 ${reviewTone(decision)}`}>
          {reviewLabel(decision)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Options for ${decision.title}`}
              className="shrink-0"
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <MenuShell as="dropdown" align="end">
            {DECISION_STATUSES.map((status) => (
              <DropdownMenuItem
                key={status}
                onClick={() => onStatus(status)}
                className="justify-between"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: statusVar(status) }}
                    aria-hidden
                  />
                  {decisionStatusLabel(status)}
                </span>
                {decision.status === status && (
                  <span className="text-[11px] text-muted-foreground">Current</span>
                )}
              </DropdownMenuItem>
            ))}
            <div className={MENU_SEPARATOR} />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-[var(--status-danger)] focus:text-[var(--status-danger)]"
            >
              Delete decision
            </DropdownMenuItem>
          </MenuShell>
        </DropdownMenu>
      </div>

      {/* The cost line. Kept visible when empty: a decision recorded without
          what it gave up is a decision half written, and hiding the gap makes
          the record look complete when it is not. */}
      <p className="text-[12px] text-muted-foreground pl-3.5 mt-0.5">
        {decision.abandoned ? (
          <>
            <span className="text-[var(--text-tertiary)]">Gave up </span>
            {decision.abandoned}
          </>
        ) : (
          <span className="text-muted-foreground/50">Nothing recorded as given up</span>
        )}
      </p>

      <p className="text-[11px] text-muted-foreground/70 pl-3.5 mt-0.5">
        {decisionStatusLabel(decision.status)}
        {decision.decidedBy ? ` · ${decision.decidedBy}` : ''}
        {decided ? ` · decided ${decided}` : ''}
        {horizonDay ? ` · review ${horizonDay}` : ''}
      </p>
    </div>
  );
}

// =============================================================
// The composer. Four fields and nothing else: any one of them missing costs
// the record something a comment thread could not keep either.
// =============================================================

/** The one field style. No ring, no border, no outline (DESIGN.md §5.3) — the
 *  focused field is the one carrying a ground, and the negative margin keeps
 *  that ground from shifting the text sideways when it appears. */
const FIELD = [
  'w-full bg-transparent border-none text-foreground',
  'rounded-sm px-1 -mx-1 transition-colors',
  'focus:bg-[var(--surface-strong)]',
].join(' ');
function Composer({
  titleRef,
  title,
  abandoned,
  horizon,
  decidedBy,
  saving,
  onTitle,
  onAbandoned,
  onHorizon,
  onDecidedBy,
  onSubmit,
  onClose,
}: {
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
  title: string;
  abandoned: string;
  horizon: string | null;
  decidedBy: string;
  saving: boolean;
  onTitle: (v: string) => void;
  onAbandoned: (v: string) => void;
  onHorizon: (v: string | null) => void;
  onDecidedBy: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  // Escape closes and nothing else. The draft stays in the parent's state, so
  // reopening the composer hands back what was typed instead of eating it.
  const escape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="rounded-lg border border-border/60 bg-card p-3 space-y-2 mt-2"
      onKeyDown={escape}
    >
      <textarea
        ref={titleRef}
        value={title}
        rows={1}
        autoFocus
        onChange={(e) => onTitle(e.target.value)}
        placeholder="What was decided"
        className={`${FIELD} text-[13px] leading-relaxed resize-none`}
      />
      <textarea
        value={abandoned}
        rows={1}
        onChange={(e) => onAbandoned(e.target.value)}
        placeholder="What it gave up"
        className={`${FIELD} text-[13px] leading-relaxed resize-none`}
      />
      <div className="flex items-center gap-2">
        <input
          value={decidedBy}
          onChange={(e) => onDecidedBy(e.target.value)}
          placeholder="Decided by"
          className={`${FIELD} flex-1 min-w-0 text-[12px]`}
        />
        <DateField
          value={horizon}
          onChange={onHorizon}
          placeholder="Review on"
          size="xs"
          aria-label="Review on"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X size={14} />
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!title.trim() || saving}
          onClick={onSubmit}
        >
          {saving ? 'Recording…' : 'Record'}
        </Button>
      </div>
    </div>
  );
}

/** The severity ramp, not the Element status ramp: a Campaign decision going
 *  off track is the same kind of claim a warning badge makes, and an Element
 *  being `blocked` is not. */
function statusVar(status: DecisionStatus): string {
  switch (status) {
    case 'at_risk':
      return 'var(--status-warning)';
    case 'off_track':
      return 'var(--status-danger)';
    case 'done':
      return 'var(--text-tertiary)';
    default:
      return 'var(--status-success)';
  }
}

/** Only a review that is owed gets colour. A future date is not news. */
function reviewTone(decision: Decision): string {
  if (!isDueForReview(decision)) return 'text-muted-foreground/60';
  return decision.review === 'overdue'
    ? 'text-[var(--status-danger)]'
    : 'text-[var(--status-warning)]';
}
