'use client';

import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import {
  addIntentBinding,
  addIntentLineage,
  createIntent,
  deleteIntent,
  removeIntentBinding,
  updateIntent,
} from '@/hooks/useSupabase';
import type { Intent, IntentBinding, IntentLineage } from '@/types/database';
import { Button } from '@/ui/button';
import { DateField } from '@/Function/shared/date';
import { MenuShell, MENU_SEPARATOR } from '@/Function/shared/menu';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { formatElementDate, fromDateOnlyString } from '@/Function/shared/dateUtils';
import {
  countDueForReview,
  decisionStatusLabel,
  DECISION_STATUSES,
  isDueForReview,
  orderDecisions,
  reviewLabel,
  type Decision,
  type DecisionStatus,
} from '@/ActivitySpace/strategy/initiative/initiativeDecisionModel';
import {
  collectDecisionReviews,
  encodeReviewBody,
  REVIEW_OUTCOMES,
  reviewOutcomeLabel,
  suggestedStatusAfter,
  type DecisionReview,
  type ReviewOutcome,
} from '@/ActivitySpace/strategy/initiative/initiativeReviewModel';
import { isAssumption } from '@/ActivitySpace/strategy/initiative/initiativeAssumptionModel';
import { isMeasure } from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';
import {
  BoundTarget,
  IntentTargetPicker,
  type PickerTarget,
} from '@/ActivitySpace/strategy/initiative/IntentTargetPicker';
import type { InitiativeIntentState } from '@/ActivitySpace/strategy/initiative/useInitiativeIntent';
import { WidgetHeaderAction } from '@/Function/widget';

// =============================================================
// InitiativeDecisions — where the choice gets written down.
//
// The sections above this one report how the Initiative is going. This one
// reports why it is going that way, and it is the only place in the app that
// keeps the two halves a decision is actually made of: the option that was
// taken, and the option that was thrown away to take it. A decision recorded as
// a comment on one Element keeps neither — the person reading the Initiative
// cannot see it, and the cost is gone the moment the thread scrolls.
//
// So every row states three things: what was chosen, what was given up, and the
// day the choice gets looked at again. The review day is the part that decays,
// which is why a decision whose day has passed is sorted to the top and says so
// rather than sitting quietly in date order.
//
// And when that day comes, what the looking found is appended underneath —
// overturned, upheld, or its terms moved — so the row keeps the whole arc of a
// choice rather than only its latest state.
//
// The last line of a row is where the choice touches the board. A decision to
// slide a date is the largest thing a Initiative does, and until it is bound to
// something it stays a paragraph: three months later the question "why is this
// running into October" has an answer here that the Phase it happened to
// cannot reach. Binding does not move any date — nothing on this surface
// writes to a start or end date, and it should not. It records where the
// decision landed, so the trail exists in both directions.
// =============================================================

/** What a decision does to an Object or an Element: the target is the vehicle
 *  the decision is realised through. */
const LANDS_ON = 'delivers' as const;

/** What a decision does to a Phase. A time box has no work in it to deliver —
 *  what a schedule call does to one is move its dates, and `reschedules` says
 *  exactly that. Deriving the relationship from the target kind rather than
 *  asking is not a shortcut: there is one true answer per kind, and a picker
 *  offering the other one would only be offering a way to be wrong. */
const RESCHEDULES = 'reschedules' as const;

/** Which relationship a target of each kind is bound with. */
function relationshipFor(type: PickerTarget['type']) {
  return type === 'phase' ? RESCHEDULES : LANDS_ON;
}

/** One `intents` row per decision, hung under the Initiative's root Intent.
 *  The table allows exactly one parent-less Intent per Initiative (a partial
 *  unique index), so the root is a spine rather than a decision: it is created
 *  on the first record, carries the Initiative's name, and is never listed. Every
 *  decision is its child, which also means deleting one cannot cascade into
 *  the others. */
export function InitiativeDecisions({
  initiative,
  onOpenObject,
}: {
  initiative: InitiativeIntentState;
  /** Open what a decision landed on. Objects go straight there; an Element
   *  opens the Object it lives in, which is as close as this app routes. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { initiativeId, data, error, refetch, ensureRoot, scope, scopeError } = initiative;

  // Written values, laid over the fetched rows. They are not cleared on
  // success — the value here *is* what the server now holds, so clearing it
  // before the refetch lands would flash the old status back. A failed write
  // puts the previous value back and surfaces the row again.
  const [edits, setEdits] = useState<Record<string, Partial<Intent>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  // Reviews the server has not handed back yet. Written entries are kept
  // alongside the fetched ones rather than replacing them, and the collector
  // deduplicates by id, so the row is right both before and after the refetch.
  const [written, setWritten] = useState<IntentLineage[]>([]);
  // The same two-sided bookkeeping for bindings: links written but not yet
  // refetched, and links removed but not yet gone from the fetched set.
  const [linked, setLinked] = useState<IntentBinding[]>([]);
  const [unlinked, setUnlinked] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewedBy, setReviewedBy] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  // Drafts live here, one per decision, so closing the composer is a close and
  // not a discard — and so opening a second decision's review does not hand
  // over the first one's finding. Cleared only when the entry is written.
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [abandoned, setAbandoned] = useState('');
  const [horizon, setHorizon] = useState<string | null>(null);
  const [decidedBy, setDecidedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  const reviews = useMemo(
    () =>
      collectDecisionReviews(
        [...(data?.lineage ?? []), ...written].map((row) => ({
          id: row.id,
          intentId: row.intent_id,
          occurredAt: row.occurred_at,
          actorName: row.actor_name,
          actionKind: row.action_kind,
          body: row.body,
        })),
      ),
    [data?.lineage, written],
  );

  const decisions = useMemo(() => {
    // Assumptions and measures share the root Intent and the table; they are
    // the other sections' rows and must not appear as decisions here. The
    // exclusion is by kind rather than by a `kind === 'decision'` test because
    // the column defaults to `decision`, and every row written before the
    // column existed carries that default legitimately.
    const rows = (data?.subs ?? [])
      .filter((i) => !isAssumption(i.kind) && !isMeasure(i.kind) && !removed.has(i.id))
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
        supersededById: i.superseded_by_intent_id ?? null,
        orderIndex: i.order_index ?? 0,
        // collectDecisionReviews sorts each list newest first.
        lastReviewedAt: reviews.get(i.id)?.[0]?.occurredAt ?? null,
      })),
      new Date(),
    );
  }, [data?.subs, edits, removed, reviews]);

  const dueCount = countDueForReview(decisions);

  // One decision reversed another: the link is stored on the reversed row, and
  // both rows say so. Titles are resolved here, once, because a row that had to
  // find its own counterpart would need the whole list to do it.
  const titleOf = useMemo(() => new Map(decisions.map((d) => [d.id, d.title])), [decisions]);
  const supersedes = useMemo(() => {
    const back = new Map<string, string>();
    for (const d of decisions) {
      if (d.supersededById) back.set(d.supersededById, d.title);
    }
    return back;
  }, [decisions]);

  /** Every decision's targets, keyed by decision. Merged by id so a link is
   *  drawn once whether it came from the write or the refetch. */
  const landings = useMemo(() => {
    const merged = new Map<string, IntentBinding>();
    for (const b of [...(data?.bindings ?? []), ...linked]) {
      // Two relationships, one row of chips. The reader asked "what did this
      // decision touch", and splitting the answer by which verb the edge
      // carries would make them read two lists to get it.
      if (b.relationship_type === LANDS_ON || b.relationship_type === RESCHEDULES) {
        merged.set(b.id, b);
      }
    }
    const objects = new Map(scope.objects.map((o) => [o.id, o]));
    const elements = new Map(scope.elements.map((el) => [el.id, el]));
    const phases = new Map(scope.phases.map((p) => [p.id, p]));
    const out = new Map<string, Landing[]>();
    for (const b of merged.values()) {
      if (unlinked.has(b.id)) continue;
      const row = out.get(b.intent_id) ?? [];
      row.push(toLanding(b, objects, elements, phases));
      out.set(b.intent_id, row);
    }
    return out;
  }, [data?.bindings, linked, unlinked, scope.objects, scope.elements, scope.phases]);

  /** What is left to link, per decision. A target already bound with this
   *  relationship would be rejected by the table's unique index, so it is not
   *  offered rather than offered and refused. */
  const candidates = useMemo(() => {
    const all: PickerTarget[] = [
      ...scope.objects.map((o) => ({
        type: 'object' as const,
        id: o.id,
        label: o.name,
        hint: null,
      })),
      ...scope.elements.map((el) => ({
        type: 'element' as const,
        id: el.id,
        label: el.title,
        hint: el.displayId,
      })),
      ...scope.phases.map((p) => ({
        type: 'phase' as const,
        id: p.id,
        label: p.name,
        hint: phaseHint(p.startDate, p.endDate),
      })),
    ];
    return (decisionId: string) => {
      const bound = new Set(
        (landings.get(decisionId) ?? []).map((l) => `${l.type}:${l.targetId}`),
      );
      return all.filter((t) => !bound.has(`${t.type}:${t.id}`));
    };
  }, [scope.objects, scope.elements, scope.phases, landings]);

  async function record() {
    const chosen = title.trim();
    if (!chosen || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const parent = await ensureRoot();
      await createIntent({
        strategy_id: initiativeId,
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

  /**
   * The append. The lineage entry is the record and goes in first; the status
   * is a summary of it and follows only if the outcome implies one.
   *
   * The two are reported separately on failure for the same reason they are
   * written in that order — a review that landed and a status that did not is
   * not a review that failed, and telling the author it was "not saved" would
   * send them to write it a second time.
   */
  async function recordReview(id: string) {
    const draft = drafts[id] ?? EMPTY_DRAFT;
    // `actor_name` is not nullable, and a placeholder standing in for a name
    // nobody gave is a fact the table did not receive. The composer asks for
    // one before it will submit.
    const actor = reviewedBy.trim();
    if (!draft.outcome || !actor || !draft.reason.trim() || reviewSaving) return;
    setReviewSaving(true);
    setFailure(null);
    try {
      const entry = await addIntentLineage({
        intent_id: id,
        occurred_at: new Date().toISOString(),
        actor_name: actor,
        actor_role: null,
        action_kind: 'revision',
        body: encodeReviewBody(draft.outcome, draft.reason),
      });
      // The link is part of the same review: a reversal that does not say what
      // replaced it leaves the reader where they started. Written after the
      // lineage entry, because the entry is the record and this is a pointer —
      // a failure here must not cost the review itself.
      //
      // Every review settles the link, including to null. A decision reversed
      // in March and upheld in June is not still reversed, and a row that kept
      // saying so would contradict the newest entry underneath it.
      const link = draft.outcome === 'reversed' ? draft.supersededBy : null;
      let linkFailed = false;
      try {
        await updateIntent(id, { superseded_by_intent_id: link });
        setEdits((prev) => ({ ...prev, [id]: { ...prev[id], superseded_by_intent_id: link } }));
      } catch (e) {
        console.error('link superseding decision failed:', e);
        linkFailed = true;
      }
      setWritten((prev) => [...prev, entry]);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewing(null);
      const next = draft.alsoStatus ? suggestedStatusAfter(draft.outcome) : null;
      // After the status write, not before: setStatus clears the failure line,
      // and a reversal always suggests a status — so reporting the broken link
      // any earlier would report it to nobody.
      if (next) await setStatus(id, next);
      if (linkFailed) {
        setFailure(link
          ? 'The review was recorded, but the decision that replaced it was not linked.'
          : 'The review was recorded, but the earlier reversal is still linked.');
      }
      refetch();
    } catch (e) {
      console.error('record review failed:', e);
      setFailure('Could not record the review. Nothing was appended.');
    } finally {
      setReviewSaving(false);
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

  async function link(decisionId: string, target: PickerTarget) {
    setFailure(null);
    try {
      const binding = await addIntentBinding({
        intent_id: decisionId,
        target_type: target.type === 'deal' ? 'crm_deal' : target.type,
        target_id: target.id,
        relationship_type: relationshipFor(target.type),
      });
      setLinked((prev) => [...prev, binding]);
      refetch();
    } catch (e) {
      console.error('bind decision to target failed:', e);
      setFailure('Could not link that. Nothing was recorded as moved.');
    }
  }

  // The chip goes at once and stays gone; it returns only if the delete failed,
  // which is the one case where showing it as unlinked would be a lie.
  async function unlink(bindingId: string) {
    setUnlinked((prev) => new Set(prev).add(bindingId));
    setFailure(null);
    try {
      await removeIntentBinding(bindingId);
      setLinked((prev) => prev.filter((b) => b.id !== bindingId));
      refetch();
    } catch (e) {
      console.error('unbind decision failed:', e);
      setUnlinked((prev) => {
        const next = new Set(prev);
        next.delete(bindingId);
        return next;
      });
      setFailure('Could not unlink that. It is still recorded as moved.');
    }
  }

  function closeComposer() {
    setComposing(false);
    setSaving(false);
  }

  return (
    <>
      {/* Heading and box are the widget frame's; these ride into its header
          slot so the composer opens from the same place it always did. */}
      <WidgetHeaderAction>
        <div className="flex items-center gap-2">
          {dueCount > 0 && (
            <span className="text-[11px] text-[var(--status-warning)] tabular-nums">
              {dueCount} due for review
            </span>
          )}
          {/* Held until the fetch lands: the root Intent is created only when
              this Initiative has none, and that is not known yet. Opening the
              composer early would let a submit race the answer and lose to the
              one-root-per-Initiative index. */}
          <button
            type="button"
            aria-label="Record a decision"
            disabled={!data || !initiative.canEdit}
            title={initiative.lockReason ?? undefined}
            onClick={() => {
              setComposing(true);
              setReviewing(null);
              setFailure(null);
            }}
            className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>
      </WidgetHeaderAction>

      {failure && (
        <p className="text-[12px] text-[var(--status-danger)] py-1">{failure}</p>
      )}

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)] py-1">
          Could not read this Initiative&apos;s decisions.
        </p>
      ) : !data ? (
        // Not `loading`: the hook reports false on the first render, before the
        // fetch it is about to start. Keying on the absence of the bundle keeps
        // "nothing decided here" from flashing over a Initiative that has a
        // decision record, which is the same lie as a fabricated zero.
        <p className="text-[12px] text-muted-foreground/50 py-1">Reading the record…</p>
      ) : decisions.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          Nothing decided here yet — record a call and what it cost, so the Initiative carries the
          reason and not just the result.
        </p>
      ) : (
        <div className="flex flex-col">
          {decisions.map((decision) => (
            <DecisionRow
              key={decision.id}
              decision={decision}
              landings={landings.get(decision.id) ?? []}
              candidates={candidates(decision.id)}
              scopeError={scopeError}
              canEdit={initiative.canEdit}
              supersededBy={titleOf.get(decision.supersededById ?? '') ?? null}
              supersedes={supersedes.get(decision.id) ?? null}
              onLink={(target) => void link(decision.id, target)}
              onUnlink={(bindingId) => void unlink(bindingId)}
              onOpenObject={onOpenObject}
              onStatus={(status) => void setStatus(decision.id, status)}
              onDelete={() => void remove(decision.id)}
              review={{
                entries: reviews.get(decision.id) ?? [],
                siblings: decisions.filter((d) => d.id !== decision.id).map((d) => ({ id: d.id, title: d.title })),
                open: reviewing === decision.id,
                saving: reviewSaving,
                reviewedBy,
                draft: drafts[decision.id] ?? EMPTY_DRAFT,
                onReviewedBy: setReviewedBy,
                onDraft: (patch) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [decision.id]: { ...(prev[decision.id] ?? EMPTY_DRAFT), ...patch },
                  })),
                // One composer at a time — two open at once would put two
                // primary buttons on the surface, and the section would be
                // asking the reader two unrelated questions.
                onOpen: () => {
                  setReviewing(decision.id);
                  setComposing(false);
                  setFailure(null);
                },
                onClose: () => setReviewing(null),
                onSubmit: () => void recordReview(decision.id),
              }}
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
    </>
  );
}

/** One bound target, resolved against the Initiative's scope. */
interface Landing {
  bindingId: string;
  type: PickerTarget['type'];
  targetId: string;
  label: string;
  hint: string | null;
  /** Where clicking it goes. Null when the target has left the Initiative's
   *  scope, when it is an Element with no Object in scope, or when it is a
   *  Phase — the Phase surface is Domain-scoped and has no route to one box. */
  objectId: string | null;
  domainId: string | null;
}

/** The period a Phase covers, short enough to sit at the end of a picker row.
 *  Two Phases in one Domain can share a name across quarters; the dates are
 *  what tell them apart. */
function phaseHint(start: string | null, end: string | null): string | null {
  const from = formatElementDate(fromDateOnlyString(start));
  const to = formatElementDate(fromDateOnlyString(end));
  if (from && to) return `${from} – ${to}`;
  return from ?? to ?? null;
}

/** A binding whose target is no longer in this Initiative's scope still shows.
 *  Hiding it would quietly drop a link the record holds, and unlinking it is
 *  the only thing a reader can do about it. */
function toLanding(
  binding: IntentBinding,
  objects: Map<string, { id: string; name: string; domainId: string | null }>,
  elements: Map<
    string,
    { id: string; title: string; displayId: string | null; objectId: string | null; domainId: string | null }
  >,
  phases: Map<string, { id: string; name: string; startDate: string | null; endDate: string | null }>,
): Landing {
  const base = {
    bindingId: binding.id,
    targetId: binding.target_id,
    hint: null as string | null,
    objectId: null as string | null,
    domainId: null as string | null,
  };
  if (binding.target_type === 'object') {
    const object = objects.get(binding.target_id);
    return object
      ? { ...base, type: 'object', label: object.name, objectId: object.id, domainId: object.domainId }
      : { ...base, type: 'object', label: 'Object outside this Initiative' };
  }
  if (binding.target_type === 'element') {
    const element = elements.get(binding.target_id);
    return element
      ? {
          ...base,
          type: 'element',
          label: element.displayId ? `${element.displayId} ${element.title}` : element.title,
          hint: element.displayId,
          objectId: element.objectId,
          domainId: element.domainId,
        }
      : { ...base, type: 'element', label: 'Element outside this Initiative' };
  }
  if (binding.target_type === 'phase') {
    const phase = phases.get(binding.target_id);
    return phase
      ? {
          ...base,
          type: 'phase',
          label: phase.name,
          hint: phaseHint(phase.startDate, phase.endDate),
        }
      : { ...base, type: 'phase', label: 'Phase outside this Initiative' };
  }
  // A Domain or Worker binding — nothing on this surface writes either, but the
  // table takes them and the assumptions section writes Workers. Shown as
  // unopenable rather than dropped.
  return { ...base, type: 'object', label: 'Bound elsewhere' };
}

/** The one field style, shared by both composers. No ring, no border, no
 *  outline (DESIGN.md §5.3) — the focused field is the one carrying a ground,
 *  and the negative margin keeps that ground from shifting the text sideways
 *  when it appears. */
const FIELD = [
  'w-full bg-transparent border-none text-foreground',
  'rounded-sm px-1 -mx-1 transition-colors',
  'focus:bg-[var(--surface-strong)]',
].join(' ');

/** An unsubmitted review. `alsoStatus` is armed from the start: a reversal that
 *  leaves the row still claiming `On track` is the collapse this section exists
 *  to undo, and the toggle is named in full so nothing moves unread. */
interface ReviewDraft {
  outcome: ReviewOutcome | null;
  reason: string;
  alsoStatus: boolean;
  /** Only a reversal has one: the decision taken in this one's place. */
  supersededBy: string | null;
}

const EMPTY_DRAFT: ReviewDraft = { outcome: null, reason: '', alsoStatus: true, supersededBy: null };

/** Everything the row needs to show and take reviews. Grouped because it is
 *  one concern, and nine loose props would read as nine. */
interface RowReview {
  entries: DecisionReview[];
  /** The Initiative's other decisions, offered when a review reverses this
   *  one. Empty when this is the only decision on the board. */
  siblings: { id: string; title: string }[];
  open: boolean;
  saving: boolean;
  reviewedBy: string;
  draft: ReviewDraft;
  onReviewedBy: (v: string) => void;
  onDraft: (patch: Partial<ReviewDraft>) => void;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: () => void;
}

// =============================================================
// A row. Three lines, because a decision has three parts and a one-line row
// can only hold the one that is least useful on its own — then the reviews
// underneath, which are the part that accumulates.
// =============================================================
function DecisionRow({
  decision,
  review,
  landings,
  candidates,
  scopeError,
  canEdit,
  supersededBy,
  supersedes,
  onLink,
  onUnlink,
  onOpenObject,
  onStatus,
  onDelete,
}: {
  decision: Decision;
  review: RowReview;
  landings: Landing[];
  candidates: PickerTarget[];
  scopeError: Error | null;
  /** A reader who is not the owner sees the decision, its reviews and its
   *  landings, and none of the controls that would change them. */
  canEdit: boolean;
  /** Title of the decision taken in this one's place, when a review reversed
   *  it. */
  supersededBy: string | null;
  /** Title of the decision this one replaced — the same edge read from the
   *  other end, so the successor is not a row that appeared from nowhere. */
  supersedes: string | null;
  onLink: (target: PickerTarget) => void;
  onUnlink: (bindingId: string) => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
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
        {/* The chip says what the review owes and opens the place to discharge
            it. Splitting those into a label and a separate action would put
            the notice and its answer in two places on the same row. The
            accessible name keeps both halves — replacing it with the action
            alone would drop "overdue" for anyone who cannot see the colour. */}
        <Button
          variant="ghost"
          size="xs"
          aria-label={`${reviewLabel(decision)}. Record a review of ${decision.title}`}
          aria-expanded={review.open}
          disabled={!canEdit}
          onClick={review.open ? review.onClose : review.onOpen}
          className={`shrink-0 ${reviewTone(decision)} disabled:opacity-100 disabled:pointer-events-none`}
        >
          {reviewLabel(decision)}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={!canEdit}
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

      {/* What happened to this call in the end. A reversal that does not name
          its replacement, and a decision that does not say what it replaced,
          are the same record with the interesting half missing. */}
      {(supersededBy || supersedes) && (
        <p className="text-[11px] text-muted-foreground/70 pl-3.5 mt-0.5">
          {supersededBy && (
            <span>
              <span className="text-[var(--status-danger)]">Reversed by </span>
              {supersededBy}
            </span>
          )}
          {supersededBy && supersedes && ' · '}
          {supersedes && (
            <span>
              <span className="text-[var(--text-tertiary)]">Replaces </span>
              {supersedes}
            </span>
          )}
        </p>
      )}

      {/* Where the choice landed. The row above says what was decided; this
          says what in the Initiative now carries it, which is the half that
          exists nowhere else — the Object's own surface has no way to name the
          decision that moved it. Linking changes no date; a person does that. */}
      <div className="flex flex-wrap items-center gap-1 pl-3.5 mt-1">
        {landings.map((landing) => (
          <BoundTarget
            key={landing.bindingId}
            type={landing.type}
            label={landing.label}
            hint={landing.hint}
            onOpen={
              landing.objectId && onOpenObject
                ? () => onOpenObject(landing.objectId as string, landing.domainId)
                : undefined
            }
            onRemove={canEdit ? () => onUnlink(landing.bindingId) : undefined}
          />
        ))}
        {canEdit && (
          <IntentTargetPicker
            label={landings.length === 0 ? 'Link what this moved' : 'Link another'}
            targets={candidates}
            onPick={onLink}
            empty={
              scopeError
                ? 'Could not read this Initiative’s Objects, Elements and Phases.'
                : 'This Initiative covers no Objects yet — add some to link what a decision moved.'
            }
          />
        )}
      </div>

      {/* The ledger. Newest first, and it only ever grows — a decision that was
          upheld in June and overturned in August has two entries, and the June
          one is why the August one is worth reading. */}
      {review.entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/50 pl-3.5 mt-0.5">Not reviewed yet</p>
      ) : (
        <ul className="pl-3.5 mt-0.5">
          {review.entries.map((entry) => (
            <li key={entry.id} className="text-[11px] text-muted-foreground/70">
              <span className={`font-medium ${outcomeTone(entry.outcome)}`}>
                {entry.outcome ? reviewOutcomeLabel(entry.outcome) : 'Reviewed'}
              </span>
              {entry.reason ? ` · ${entry.reason}` : ''}
              {` · ${entry.actorName}`}
              {formatElementDate(entry.occurredAt)
                ? ` · ${formatElementDate(entry.occurredAt)}`
                : ''}
            </li>
          ))}
        </ul>
      )}

      {review.open && <ReviewComposer decisionTitle={decision.title} review={review} />}
    </div>
  );
}

// =============================================================
// The review composer. Three fields, and the outcome is the one that cannot be
// skipped — a review whose result is only prose leaves the finding back in the
// free text this section exists to get it out of.
// =============================================================
function ReviewComposer({
  decisionTitle,
  review,
}: {
  decisionTitle: string;
  review: RowReview;
}) {
  const { draft, reviewedBy, saving, siblings, onDraft, onReviewedBy, onSubmit, onClose } = review;
  const suggested = draft.outcome ? suggestedStatusAfter(draft.outcome) : null;

  // Escape closes and nothing else — the draft is the parent's, so reopening
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
      <div className="flex items-center gap-1">
        {REVIEW_OUTCOMES.map((o) => (
          <Button
            key={o}
            variant={draft.outcome === o ? 'secondary' : 'ghost'}
            size="xs"
            aria-pressed={draft.outcome === o}
            onClick={() => onDraft({ outcome: o, alsoStatus: true })}
          >
            {reviewOutcomeLabel(o)}
          </Button>
        ))}
      </div>
      <input
        value={draft.reason}
        autoFocus
        onChange={(e) => onDraft({ reason: e.target.value })}
        placeholder="Why it landed that way"
        aria-label={`Why the review of ${decisionTitle} landed that way`}
        className={`${FIELD} text-[13px]`}
      />
      {/* Only a reversal asks this, and only when there is something to point
          at. The replacement is usually recorded first — a person reverses a
          call because they have made another one — so this offers the
          Initiative's other decisions rather than creating one. */}
      {draft.outcome === 'reversed' && siblings.length > 0 && (
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          Replaced by
          <select
            value={draft.supersededBy ?? ''}
            onChange={(e) => onDraft({ supersededBy: e.target.value || null })}
            aria-label={`The decision taken in place of ${decisionTitle}`}
            className={`${FIELD} flex-1 min-w-0 text-[12px]`}
          >
            <option value="">Not recorded</option>
            {siblings.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          value={reviewedBy}
          onChange={(e) => onReviewedBy(e.target.value)}
          placeholder="Reviewed by"
          className={`${FIELD} flex-1 min-w-0 text-[12px]`}
        />
        {suggested && (
          <Button
            variant={draft.alsoStatus ? 'secondary' : 'ghost'}
            size="xs"
            aria-pressed={draft.alsoStatus}
            onClick={() => onDraft({ alsoStatus: !draft.alsoStatus })}
          >
            Set the status to {decisionStatusLabel(suggested)}
          </Button>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X size={14} />
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!draft.outcome || !draft.reason.trim() || !reviewedBy.trim() || saving}
          onClick={onSubmit}
        >
          {saving ? 'Recording…' : 'Record review'}
        </Button>
      </div>
    </div>
  );
}

// =============================================================
// The composer. Four fields and nothing else: any one of them missing costs
// the record something a comment thread could not keep either.
// =============================================================
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

/** The severity ramp, not the Element status ramp: a Initiative decision going
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

/** Only a review that is owed gets colour. A future date is not news.
 *
 *  The hover tone is pinned to the resting one because the chip is pressable:
 *  the ghost variant would otherwise pull an overdue chip back to the ordinary
 *  text colour under the cursor, dropping the warning at the moment the reader
 *  is reaching for it. The hover feedback is the ground (DESIGN.md §5.1). */
function reviewTone(decision: Decision): string {
  if (!isDueForReview(decision)) {
    return 'text-muted-foreground/60 hover:text-muted-foreground';
  }
  return decision.review === 'overdue'
    ? 'text-[var(--status-danger)] hover:text-[var(--status-danger)]'
    : 'text-[var(--status-warning)] hover:text-[var(--status-warning)]';
}

/** A reversal is the only outcome that is news. A decision that survived its
 *  review is the expected case, and colouring it would spend the reader's
 *  attention on the entries that did not change anything. */
function outcomeTone(outcome: ReviewOutcome | null): string {
  return outcome === 'reversed' ? 'text-[var(--status-danger)]' : 'text-foreground/70';
}
