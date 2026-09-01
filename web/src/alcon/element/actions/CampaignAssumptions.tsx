'use client';

import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import {
  addIntentBinding,
  createIntent,
  deleteIntent,
  removeIntentBinding,
} from '@/hooks/useSupabase';
import type { IntentBinding } from '@/types/database';
import { Button } from '@/ui/button';
import { STATUS } from '@/shared/designTokens';
import { MenuShell } from '@/alcon/shared/menu';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { formatElementDate } from '@/alcon/shared/dateUtils';
import {
  countShaken,
  isAssumption,
  orderAssumptions,
  shakenLabel,
  watchLabel,
  type Assumption,
  type Watch,
  type WatchInput,
} from '@/alcon/element/actions/campaignAssumptionModel';
import { BoundTarget, IntentTargetPicker } from '@/alcon/element/actions/IntentTargetPicker';
import type { CampaignIntentState } from '@/alcon/element/actions/useCampaignIntent';

// =============================================================
// CampaignAssumptions — what the plan is standing on.
//
// The section below this one records what was chosen. This one records what was
// not chosen but simply believed: the one person who speaks the language, the
// vendor who ships in March, the existing line that runs on leftovers. Nobody
// argues about these, which is exactly why they end up in a description
// paragraph and are never looked at again.
//
// An assumption written down still fails silently. It breaks inside an Element
// — the work that depended on it goes blocked, or slides past its date — and
// the Campaign page keeps last week's face because nothing joins the two. So an
// assumption here names the Elements that could falsify it, and their state is
// read back onto it. The mark is not a verdict; it is the Campaign saying
// somebody should go and look.
// =============================================================

/** Every relationship in `intent_bindings` says why the edge exists, and this
 *  one is the reason the column has five values: `tests` is documented as "the
 *  target falsifies (or confirms) an assumption". Nothing here needed inventing. */
const FALSIFIES = 'tests' as const;

export function CampaignAssumptions({
  campaign,
  onOpenObject,
}: {
  campaign: CampaignIntentState;
  /** Elements have no route of their own, so a watched Element opens the Object
   *  it lives in — the same destination the risk findings use. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { campaignId, data, error, refetch, ensureRoot, scope, scopeError } = campaign;

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

  const assumptions = useMemo(() => {
    // Written and fetched bindings both appear once the refetch lands, so the
    // two lists are merged by id rather than concatenated — a chip drawn twice
    // for one link reads as two links.
    const merged = new Map<string, IntentBinding>();
    for (const b of [...(data?.bindings ?? []), ...written]) {
      if (b.relationship_type === FALSIFIES && b.target_type === 'element') merged.set(b.id, b);
    }
    const bindings = [...merged.values()].filter((b) => !unlinked.has(b.id));
    const rows = (data?.subs ?? [])
      .filter((i) => isAssumption(i.kind) && !removed.has(i.id))
      .map((intent) => ({
        id: intent.id,
        title: intent.title,
        cost: intent.subtitle ?? null,
        notedBy: intent.decided_by_name ?? null,
        notedAt: intent.decided_at ?? null,
        orderIndex: intent.order_index ?? 0,
        watches: bindings
          .filter((b) => b.intent_id === intent.id)
          .map((b) => toWatch(b, byElement.get(b.target_id))),
      }));
    return orderAssumptions(rows, new Date());
  }, [data?.subs, data?.bindings, written, removed, unlinked, byElement]);

  const shakenCount = countShaken(assumptions);

  async function record() {
    const said = statement.trim();
    if (!said || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const parent = await ensureRoot();
      await createIntent({
        strategy_id: campaignId,
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

  async function watch(intentId: string, elementId: string) {
    setFailure(null);
    try {
      const binding = await addIntentBinding({
        intent_id: intentId,
        target_type: 'element',
        target_id: elementId,
        relationship_type: FALSIFIES,
      });
      setWritten((prev) => [...prev, binding]);
      refetch();
    } catch (e) {
      console.error('bind assumption to element failed:', e);
      setFailure('Could not watch that Element. Nothing was linked.');
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
      setFailure('Could not unlink that Element. It is still watched.');
    }
  }

  return (
    <section>
      <div className="h-px bg-border mb-3" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-medium text-foreground/90">Assumptions</h2>
        <div className="flex items-center gap-2">
          {shakenCount > 0 && (
            <span className="text-[11px] text-[var(--status-warning)] tabular-nums">
              {shakenCount} shaken
            </span>
          )}
          {/* Held until the fetch lands, for the same reason the decisions
              composer is: the root Intent is created only when this Campaign
              has none, and that is not known yet. */}
          <button
            type="button"
            aria-label="Record an assumption"
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

      {failure && <p className="text-[12px] text-[var(--status-danger)] py-1">{failure}</p>}

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)] py-1">
          Could not read this Campaign&apos;s assumptions.
        </p>
      ) : !data ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">Reading the record…</p>
      ) : assumptions.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          Nothing written down as assumed — name what this Campaign is standing on, and the
          Elements that would tell you it stopped being true.
        </p>
      ) : (
        <div className="flex flex-col">
          {assumptions.map((assumption) => (
            <AssumptionRow
              key={assumption.id}
              assumption={assumption}
              candidates={scope.elements
                .filter((el) => !assumption.watches.some((w) => w.elementId === el.id))
                .map((el) => ({
                  type: 'element' as const,
                  id: el.id,
                  label: el.title,
                  hint: el.displayId,
                }))}
              onDelete={() => void remove(assumption.id)}
              onWatch={(elementId) => void watch(assumption.id, elementId)}
              onUnwatch={(bindingId) => void unwatch(bindingId)}
              scopeError={scopeError}
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
    </section>
  );
}

/** A binding whose Element is not in this Campaign's scope — moved out, or
 *  deleted. It is still shown: dropping the row would hide a link the record
 *  holds, and the only thing a reader can do about it is unlink it. */
function toWatch(binding: IntentBinding, element: WatchSource | undefined): WatchInput {
  if (!element) {
    return {
      bindingId: binding.id,
      elementId: binding.target_id,
      displayId: null,
      title: 'Element outside this Campaign',
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

const FIELD = [
  'w-full bg-transparent border-none text-foreground',
  'rounded-sm px-1 -mx-1 transition-colors',
  'focus:bg-[var(--surface-strong)]',
].join(' ');

// =============================================================
// A row. The statement, what it costs, and the Elements standing in for it —
// which is the only line here that changes on its own.
// =============================================================
function AssumptionRow({
  assumption,
  candidates,
  scopeError,
  onDelete,
  onWatch,
  onUnwatch,
  onOpenObject,
}: {
  assumption: Assumption;
  candidates: { type: 'element'; id: string; label: string; hint: string | null }[];
  scopeError: Error | null;
  onDelete: () => void;
  onWatch: (elementId: string) => void;
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
            onRemove={() => onUnwatch(w.bindingId)}
          />
        ))}
        <IntentTargetPicker
          label={assumption.unwatched ? 'Watch an Element' : 'Watch another'}
          targets={candidates}
          onPick={(target) => onWatch(target.id)}
          empty={
            scopeError
              ? 'Could not read this Campaign’s Elements.'
              : 'This Campaign has no Elements yet — link Objects with work in them first.'
          }
        />
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
        placeholder="What this Campaign is taking as true"
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
