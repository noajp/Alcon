'use client';

import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import {
  addIntentBinding,
  createIntent,
  deleteIntent,
  removeIntentBinding,
  useWorkerAvailability,
  useWorkers,
  useWorkersByIds,
} from '@/hooks/useSupabase';
import type { IntentBinding, Worker } from '@/types/database';
import { useCrm } from '@/hooks/useCrm';
import type { CrmDeal } from '@/ActivitySpace/sustainment/crm/crmModel';
import { Button } from '@/ui/button';
import { STATUS } from '@/shared/designTokens';
import { MenuShell } from '@/Function/shared/menu';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { formatElementDate } from '@/Function/shared/dateUtils';
import {
  ABSENCE_WINDOW_DAYS,
  countShaken,
  isAssumption,
  orderAssumptions,
  shakenLabel,
  watchLabel,
  workerWatchLabel,
  type Assumption,
  type DealWatchInput,
  type Watch,
  type WatchInput,
  type WorkerWatch,
  type WorkerWatchInput,
} from '@/ActivitySpace/strategy/initiative/initiativeAssumptionModel';
import {
  BoundTarget,
  IntentTargetPicker,
  type PickerTarget,
} from '@/ActivitySpace/strategy/initiative/IntentTargetPicker';
import type { InitiativeIntentState } from '@/ActivitySpace/strategy/initiative/useInitiativeIntent';
import { WidgetHeaderAction } from '@/Function/widget';

// =============================================================
// InitiativeAssumptions — what the plan is standing on.
//
// The section below this one records what was chosen. This one records what was
// not chosen but simply believed: the one person who speaks the language, the
// vendor who ships in March, the existing line that runs on leftovers. Nobody
// argues about these, which is exactly why they end up in a description
// paragraph and are never looked at again.
//
// An assumption written down still fails silently. It breaks inside an Element
// — the work that depended on it goes blocked, or slides past its date — and
// the Initiative page keeps last week's face because nothing joins the two. So an
// assumption here names what could falsify it, and that state is read back onto
// it. The mark is not a verdict; it is the Initiative saying somebody should go
// and look.
//
// Half of these assumptions have a person as their subject, and those cannot be
// bound to work at all: "she is the only one who has sat a review" is not a
// claim about any Element, and no Element's status can contradict it. What
// contradicts it is her having no hours — a fact the board already holds, in
// `worker_availability`, and used to hold in a second place with no wire
// between them. Binding the assumption to the Worker is that wire, and the
// absence is read back the same way a blocked Element is.
// =============================================================

/** Every relationship in `intent_bindings` says why the edge exists, and this
 *  one is the reason the column carries them: `tests` is documented as "the
 *  target falsifies (or confirms) an assumption". It is the same relationship
 *  whether the target is an Element or a Worker — what is being said about them
 *  is the same sentence. */
const FALSIFIES = 'tests' as const;

/** The target kinds this surface writes: Elements, Workers and CRM deals. A
 *  `domain` binding is legal in the table and never written here. */
const WATCHABLE = new Set(['element', 'worker', 'crm_deal']);

export function InitiativeAssumptions({
  initiative,
  onOpenObject,
}: {
  initiative: InitiativeIntentState;
  /** Elements have no route of their own, so a watched Element opens the Object
   *  it lives in — the same destination the risk findings use. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { initiativeId, data, error, refetch, ensureRoot, scope, scopeError } = initiative;

  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  // Bindings the server has not handed back yet, and ones whose delete is in
  // flight. Kept beside the fetched rows rather than replacing them, so a row
  // is right both before and after the refetch — and a failed write puts the
  // previous state back rather than leaving a chip that does not exist.
  const [written, setWritten] = useState<IntentBinding[]>([]);
  const [unlinked, setUnlinked] = useState<Set<string>>(new Set());

  const [composing, setComposing] = useState(false);
  const [statement, setStatement] = useState('');
  const [cost, setCost] = useState('');
  const [notedBy, setNotedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const statementRef = useRef<HTMLTextAreaElement | null>(null);

  const byElement = useMemo(
    () => new Map(scope.elements.map((el) => [el.id, el])),
    [scope.elements],
  );


  // Written and fetched bindings both appear once the refetch lands, so the two
  // lists are merged by id rather than concatenated — a chip drawn twice for
  // one link reads as two links.
  const bindings = useMemo(() => {
    const merged = new Map<string, IntentBinding>();
    for (const b of [...(data?.bindings ?? []), ...written]) {
      if (b.relationship_type === FALSIFIES && WATCHABLE.has(b.target_type)) merged.set(b.id, b);
    }
    return [...merged.values()].filter((b) => !unlinked.has(b.id));
  }, [data?.bindings, written, unlinked]);

  // Availability is asked for only about the Workers something is actually
  // bound to. The roster is every person in the Space, and their absences are
  // not this surface's business until an assumption names one of them.
  const boundWorkerIds = useMemo(
    () => [...new Set(bindings.filter((b) => b.target_type === 'worker').map((b) => b.target_id))],
    [bindings],
  );
  const { byWorker: availability } = useWorkerAvailability(boundWorkerIds);
  // The whole roster, not the Initiative's slice of it: a Worker is not owned by
  // a Initiative, and the person an assumption rests on is often the one with no
  // Object of their own. A bound Worker outside the active Space's roster is
  // read by id so it still shows by name.
  const { data: roster } = useWorkers();
  const boundWorkers = useWorkersByIds(boundWorkerIds);
  const byWorker = useMemo(
    () => new Map([...boundWorkers, ...roster].map((w) => [w.id, w])),
    [roster, boundWorkers],
  );

  // Deals, as the CRM reads them for this reader: health and renewal included.
  // Read only when a deal is watched or the reader can add one.
  const watchesDeals = bindings.some((b) => b.target_type === 'crm_deal');
  const crm = useCrm(null, { active: watchesDeals || initiative.canEdit });
  const crmRead: DealWatchInput['read'] = crm.error ? 'failed' : crm.loading && crm.pipelines.length > 0 ? 'loading' : 'ok';
  const byDeal = useMemo(
    () => new Map(crm.workspaces.flatMap((workspace) => workspace.deals).map((deal) => [deal.id, deal])),
    [crm.workspaces],
  );

  const assumptions = useMemo(() => {
    const rows = (data?.subs ?? [])
      .filter((i) => isAssumption(i.kind) && !removed.has(i.id))
      .map((intent) => {
        const mine = bindings.filter((b) => b.intent_id === intent.id);
        return {
          id: intent.id,
          title: intent.title,
          cost: intent.subtitle ?? null,
          notedBy: intent.decided_by_name ?? null,
          notedAt: intent.decided_at ?? null,
          orderIndex: intent.order_index ?? 0,
          watches: mine
            .filter((b) => b.target_type === 'element')
            .map((b) => toWatch(b, byElement.get(b.target_id))),
          workers: mine
            .filter((b) => b.target_type === 'worker')
            .map((b) =>
              toWorkerWatch(b, byWorker.get(b.target_id), availability[b.target_id] ?? []),
            ),
          deals: mine
            .filter((b) => b.target_type === 'crm_deal')
            .map((b) => toDealWatch(b, byDeal, crmRead)),
        };
      });
    return orderAssumptions(rows, new Date());
  }, [data?.subs, bindings, removed, byElement, byWorker, availability, byDeal, crmRead]);

  const shakenCount = countShaken(assumptions);

  async function record() {
    const said = statement.trim();
    if (!said || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const parent = await ensureRoot();
      await createIntent({
        strategy_id: initiativeId,
        parent_intent_id: parent,
        kind: 'assumption',
        title: said,
        subtitle: cost.trim() || null,
        decided_by_name: notedBy.trim() || null,
        decided_at: new Date().toISOString(),
        status: 'on_track',
        order_index: (data?.subs.length ?? 0) + 1,
      });
      // The statement clears, the person does not: writing down what a plan
      // rests on is one sitting, and re-typing the name each time is the part
      // that gets skipped first.
      setStatement('');
      setCost('');
      refetch();
      statementRef.current?.focus();
    } catch (e) {
      console.error('record assumption failed:', e);
      setFailure('Could not record the assumption. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setRemoved((prev) => new Set(prev).add(id));
    setFailure(null);
    try {
      await deleteIntent(id);
      refetch();
    } catch (e) {
      console.error('delete assumption failed:', e);
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFailure('Could not delete the assumption. It is still recorded.');
    }
  }

  async function watch(intentId: string, target: PickerTarget) {
    setFailure(null);
    try {
      const binding = await addIntentBinding({
        intent_id: intentId,
        target_type: target.type === 'deal' ? 'crm_deal' : target.type,
        target_id: target.id,
        relationship_type: FALSIFIES,
      });
      setWritten((prev) => [...prev, binding]);
      refetch();
    } catch (e) {
      console.error('bind assumption to target failed:', e);
      setFailure(
        target.type === 'worker'
          ? 'Could not watch that Worker. Nothing was linked.'
          : target.type === 'deal'
            ? 'Could not watch that deal. Nothing was linked.'
            : 'Could not watch that Element. Nothing was linked.',
      );
    }
  }

  // The chip goes at once and stays gone — the row it left is the answer to
  // whether the click registered. It comes back only if the delete failed,
  // which is the one case where saying "unlinked" would be a lie.
  async function unwatch(bindingId: string) {
    setUnlinked((prev) => new Set(prev).add(bindingId));
    setFailure(null);
    try {
      await removeIntentBinding(bindingId);
      setWritten((prev) => prev.filter((b) => b.id !== bindingId));
      refetch();
    } catch (e) {
      console.error('unbind assumption failed:', e);
      setUnlinked((prev) => {
        const next = new Set(prev);
        next.delete(bindingId);
        return next;
      });
      setFailure('Could not unlink that. It is still watched.');
    }
  }

  return (
    <>
      {/* Heading and box are the widget frame's; these ride into its header
          slot so the composer opens from the same place it always did. */}
      <WidgetHeaderAction>
        <div className="flex items-center gap-2">
          {shakenCount > 0 && (
            <span className="text-[11px] text-[var(--status-warning)] tabular-nums">
              {shakenCount} shaken
            </span>
          )}
          {/* Held until the fetch lands, for the same reason the decisions
              composer is: the root Intent is created only when this Initiative
              has none, and that is not known yet. */}
          <button
            type="button"
            aria-label="Record an assumption"
            disabled={!data || !initiative.canEdit}
            title={initiative.lockReason ?? undefined}
            onClick={() => {
              setComposing(true);
              setFailure(null);
            }}
            className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>
      </WidgetHeaderAction>

      {failure && <p className="text-[12px] text-[var(--status-danger)] py-1">{failure}</p>}

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)] py-1">
          Could not read this Initiative&apos;s assumptions.
        </p>
      ) : !data ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">Reading the record…</p>
      ) : assumptions.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          Nothing written down as assumed — name what this Initiative is standing on, and the
          Elements that would tell you it stopped being true.
        </p>
      ) : (
        <div className="flex flex-col">
          {assumptions.map((assumption) => (
            <AssumptionRow
              key={assumption.id}
              assumption={assumption}
              candidates={[
                ...scope.elements
                  .filter((el) => !assumption.watches.some((w) => w.elementId === el.id))
                  .map((el) => ({
                    type: 'element' as const,
                    id: el.id,
                    label: el.title,
                    hint: el.displayId,
                  })),
                ...roster
                  .filter((w) => !assumption.workers.some((bound) => bound.workerId === w.id))
                  .map((w) => ({
                    type: 'worker' as const,
                    id: w.id,
                    label: w.name,
                    hint: w.role,
                  })),
                // Deals still in play or won (a won deal can still fail to renew).
                ...[...byDeal.values()]
                  .filter((deal) => deal.outcome !== 'lost' && !assumption.deals.some((bound) => bound.dealId === deal.id))
                  .map((deal) => ({
                    type: 'deal' as const,
                    id: deal.id,
                    label: `D-${deal.number} ${deal.name}`,
                    hint: deal.account,
                  })),
              ]}
              onDelete={() => void remove(assumption.id)}
              onWatch={(target) => void watch(assumption.id, target)}
              onUnwatch={(bindingId) => void unwatch(bindingId)}
              scopeError={scopeError}
              canEdit={initiative.canEdit}
              onOpenObject={onOpenObject}
            />
          ))}
        </div>
      )}

      {composing && (
        <Composer
          statementRef={statementRef}
          statement={statement}
          cost={cost}
          notedBy={notedBy}
          saving={saving}
          onStatement={setStatement}
          onCost={setCost}
          onNotedBy={setNotedBy}
          onSubmit={() => void record()}
          onClose={() => {
            setComposing(false);
            setSaving(false);
          }}
        />
      )}
    </>
  );
}

/** A binding whose Element is not in this Initiative's scope — moved out, or
 *  deleted. It is still shown: dropping the row would hide a link the record
 *  holds, and the only thing a reader can do about it is unlink it. */
function toWatch(binding: IntentBinding, element: WatchSource | undefined): WatchInput {
  if (!element) {
    return {
      bindingId: binding.id,
      elementId: binding.target_id,
      displayId: null,
      title: 'Element outside this Initiative',
      status: null,
      dueDate: null,
      objectId: null,
      domainId: null,
    };
  }
  return {
    bindingId: binding.id,
    elementId: element.id,
    displayId: element.displayId,
    title: element.title,
    status: element.status,
    dueDate: element.dueDate,
    objectId: element.objectId,
    domainId: element.domainId,
  };
}

interface WatchSource {
  id: string;
  displayId: string | null;
  title: string;
  status: string | null;
  dueDate: string | null;
  objectId: string | null;
  domainId: string | null;
}

/** A deal the reader cannot see keeps its row and reports nothing, like a
 *  Worker off the roster: the link is the record's, the deal is not theirs.
 *  While the CRM is still loading, or failed, the row says so instead. A won
 *  deal that has been renewed is read through its renewal: "the customer
 *  renews" holds or fails with the renewal deal, not the old contract. */
function toDealWatch(binding: IntentBinding, byDeal: ReadonlyMap<string, CrmDeal>, read: DealWatchInput['read']): DealWatchInput {
  const bound = byDeal.get(binding.target_id);
  if (!bound) {
    const label = read === 'loading' ? 'Reading the deal…' : read === 'failed' ? 'Could not read the CRM' : 'Deal you cannot see';
    return { bindingId: binding.id, dealId: binding.target_id, label, read: read === 'ok' ? 'hidden' : read, outcome: null, atRisk: false, closeDate: null, renewalOverdue: false };
  }
  let deal = bound;
  for (let hops = 0; hops < 10 && deal.outcome === 'won' && deal.renewedBy && byDeal.has(deal.renewedBy); hops += 1) deal = byDeal.get(deal.renewedBy)!;
  return {
    bindingId: binding.id,
    dealId: bound.id,
    label: deal === bound ? `D-${bound.number} ${bound.name}` : `D-${bound.number} ${bound.name} → D-${deal.number}`,
    read: 'ok',
    outcome: deal.outcome,
    atRisk: deal.health.level === 'risk',
    closeDate: deal.closeDate,
    renewalOverdue: deal.action?.code === 'renewal_due' && deal.action.urgency === 'overdue',
  };
}

/** A binding whose Worker has left the roster keeps its row and reports no
 *  absence. The model refuses to judge a Worker it cannot read, so the chip
 *  says who is missing rather than claiming they are here. */
function toWorkerWatch(
  binding: IntentBinding,
  worker: Worker | undefined,
  spans: readonly { start_date: string; end_date: string; capacity_hours_per_day: number }[],
): WorkerWatchInput {
  if (!worker) {
    return {
      bindingId: binding.id,
      workerId: binding.target_id,
      name: 'Worker off this roster',
      role: null,
      worker: null,
      spans: [],
    };
  }
  return {
    bindingId: binding.id,
    workerId: worker.id,
    name: worker.name,
    role: worker.role,
    worker,
    spans,
  };
}

const FIELD = [
  'w-full bg-transparent border-none text-foreground',
  'rounded-sm px-1 -mx-1 transition-colors',
  'focus:bg-[var(--surface-strong)]',
].join(' ');

// =============================================================
// A row. The statement, what it costs, and what stands in for it — the Elements
// that would break, the people it rests on. That last line is the only one here
// that changes on its own.
// =============================================================
function AssumptionRow({
  assumption,
  candidates,
  scopeError,
  canEdit,
  onDelete,
  onWatch,
  onUnwatch,
  onOpenObject,
}: {
  assumption: Assumption;
  candidates: PickerTarget[];
  scopeError: Error | null;
  /** A reader who is not the owner sees what is watched and how it is
   *  faring, and none of the controls that would change the watch list. */
  canEdit: boolean;
  onDelete: () => void;
  onWatch: (target: PickerTarget) => void;
  onUnwatch: (bindingId: string) => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const noted = formatElementDate(assumption.notedAt);

  return (
    <div className="py-2 border-b border-border/40 last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          className="size-1.5 rounded-full shrink-0"
          style={{
            background: assumption.shaken ? 'var(--status-warning)' : 'var(--text-tertiary)',
          }}
          aria-hidden
        />
        <span className="text-[13px] font-[550] text-foreground truncate min-w-0 flex-1">
          {assumption.title}
        </span>
        {/* Only a shaken assumption says anything. One that is holding has no
            news, and a badge on it would spend the reader's attention on the
            rows that did not change. */}
        {assumption.shaken && (
          <span className="text-[11px] font-medium text-[var(--status-warning)] shrink-0">
            {shakenLabel(assumption)}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!canEdit}
              aria-label={`Options for ${assumption.title}`}
              className="shrink-0"
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <MenuShell as="dropdown" align="end">
            <DropdownMenuItem
              onClick={onDelete}
              className="text-[var(--status-danger)] focus:text-[var(--status-danger)]"
            >
              Delete assumption
            </DropdownMenuItem>
          </MenuShell>
        </DropdownMenu>
      </div>

      {/* Kept visible when empty, the same way the decisions row keeps its cost
          line: an assumption whose price nobody wrote down reads as a small one. */}
      <p className="text-[12px] text-muted-foreground pl-3.5 mt-0.5">
        {assumption.cost ? (
          <>
            <span className="text-[var(--text-tertiary)]">Costs </span>
            {assumption.cost}
          </>
        ) : (
          <span className="text-muted-foreground/50">Nothing recorded as at stake</span>
        )}
      </p>

      {(assumption.notedBy || noted) && (
        <p className="text-[11px] text-muted-foreground/70 pl-3.5 mt-0.5">
          {[assumption.notedBy, noted ? `noted ${noted}` : null].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 pl-3.5 mt-1">
        {assumption.watches.map((w) => (
          <BoundTarget
            key={w.bindingId}
            type="element"
            label={w.displayId ? `${w.displayId} ${w.title}` : w.title}
            hint={w.displayId}
            signal={signalOf(w)}
            onOpen={
              w.objectId && onOpenObject
                ? () => onOpenObject(w.objectId as string, w.domainId)
                : undefined
            }
            onRemove={canEdit ? () => onUnwatch(w.bindingId) : undefined}
          />
        ))}
        {/* People sit in the same row as Elements, after them. They are the
            same claim — "this is what would tell you the assumption stopped
            being true" — and splitting them into two lines would make the
            Initiative read as if a person were a different kind of evidence. */}
        {assumption.workers.map((w) => (
          <BoundTarget
            key={w.bindingId}
            type="worker"
            label={w.name}
            hint={w.role}
            signal={workerSignalOf(w)}
            onRemove={canEdit ? () => onUnwatch(w.bindingId) : undefined}
          />
        ))}
        {/* Customers and counterparts, last: the same claim again, about who
            the plan depends on outside the organisation. */}
        {assumption.deals.map((d) => (
          <BoundTarget
            key={d.bindingId}
            type="deal"
            label={d.label}
            hint={null}
            signal={d.trouble ? { text: DEAL_TROUBLE[d.trouble], tone: d.trouble === 'lost' || d.trouble === 'renewal overdue' ? 'text-[var(--status-danger)]' : 'text-[var(--status-warning)]' } : null}
            onRemove={canEdit ? () => onUnwatch(d.bindingId) : undefined}
          />
        ))}
        {canEdit && (
          <IntentTargetPicker
            label={assumption.unwatched ? 'Watch an Element, Worker or deal' : 'Watch another'}
            targets={candidates}
            onPick={onWatch}
            empty={
              scopeError
                ? 'Could not read this Initiative’s Elements.'
                : 'Nothing left to watch — link Objects with work in them, add Workers, or add deals in the CRM.'
            }
          />
        )}
      </div>

      {/* An assumption nothing can contradict is not a safe one; it is one
          nobody arranged to hear about. Said out loud rather than left as an
          empty row, for the same reason a decision with no review date says so. */}
      {assumption.unwatched && (
        <p className="text-[11px] text-muted-foreground/50 pl-3.5 mt-0.5">
          Nothing is watching this — it cannot tell you when it stops being true.
        </p>
      )}
    </div>
  );
}

const DEAL_TROUBLE = { lost: 'Lost', 'renewal overdue': 'Renewal overdue', 'at risk': 'At risk', 'close date passed': 'Past close date' } as const;

/** The tones the risk surface already uses for the same two readings, so a
 *  blocked Element looks the same here as it does two sections up. */
function signalOf(watch: Watch): { text: string; tone: string } | null {
  const text = watchLabel(watch);
  if (!text) return null;
  return {
    text,
    tone: watch.blocked ? STATUS.blocked.color : 'text-[var(--status-danger)]',
  };
}

/**
 * The same two bands, for a person.
 *
 * Away now is the danger tone for the reason an overdue Element carries it: it
 * has already happened, and the window for arranging anything else closed while
 * nobody was looking. An absence still ahead is a warning — the assumption is
 * shaken either way, but one of them can still be answered.
 */
function workerSignalOf(
  watch: WorkerWatch,
): { text: string; tone: string; title: string } | null {
  const text = workerWatchLabel(watch);
  if (!text) return null;
  return {
    text,
    tone: watch.awayIn === 0 ? 'text-[var(--status-danger)]' : 'text-[var(--status-warning)]',
    title: `${watch.name} has no hours on ${watch.awayDays} of the next ${ABSENCE_WINDOW_DAYS} days`,
  };
}

// =============================================================
// The composer. What is believed, what it costs when it is wrong, and who said
// so. Three fields, none of which another section already holds.
// =============================================================
function Composer({
  statementRef,
  statement,
  cost,
  notedBy,
  saving,
  onStatement,
  onCost,
  onNotedBy,
  onSubmit,
  onClose,
}: {
  statementRef: React.RefObject<HTMLTextAreaElement | null>;
  statement: string;
  cost: string;
  notedBy: string;
  saving: boolean;
  onStatement: (v: string) => void;
  onCost: (v: string) => void;
  onNotedBy: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  // Escape closes and nothing else. The draft is the parent's, so reopening
  // hands back what was typed instead of eating it.
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
        ref={statementRef}
        value={statement}
        rows={1}
        autoFocus
        onChange={(e) => onStatement(e.target.value)}
        placeholder="What this Initiative is taking as true"
        className={`${FIELD} text-[13px] leading-relaxed resize-none`}
      />
      <textarea
        value={cost}
        rows={1}
        onChange={(e) => onCost(e.target.value)}
        placeholder="What it costs if it stops being true"
        className={`${FIELD} text-[13px] leading-relaxed resize-none`}
      />
      <input
        value={notedBy}
        onChange={(e) => onNotedBy(e.target.value)}
        placeholder="Noted by"
        className={`${FIELD} text-[12px]`}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X size={14} />
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!statement.trim() || saving} onClick={onSubmit}>
          {saving ? 'Recording…' : 'Record'}
        </Button>
      </div>
    </div>
  );
}
