'use client';

import { useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';
import { createIntent, deleteIntent, updateIntent } from '@/hooks/useSupabase';
import type { Intent, MeasureDirection } from '@/types/database';
import { Button } from '@/ui/button';
import { MenuShell } from '@/alcon/shared/menu';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { formatElementDate } from '@/alcon/shared/dateUtils';
import {
  directionLabel,
  isMeasure,
  MEASURE_DIRECTIONS,
  measureStateLabel,
  orderMeasures,
  parseMeasureValue,
  tallyMeasures,
  targetLabel,
  targetSentence,
  type Measure,
  type MeasureState,
} from '@/alcon/element/actions/campaignMeasureModel';
import type { CampaignIntentState } from '@/alcon/element/actions/useCampaignIntent';

// =============================================================
// CampaignMeasures — the two numbers, side by side.
//
// This is the section a Campaign is judged against, and until now it was the
// one thing the board could not hold. Success conditions were written into the
// description as prose and the readings arrived as prose in comments, so a
// Campaign whose accreditation was already failing on three of five conditions
// looked exactly like one that was passing all five.
//
// Nothing here collects a number. The numbers come from wherever the work
// actually produces them — an audit sheet, a ward round, somebody's weekly
// export — and a person carries them in. What the board owes that person is a
// place to put the reading that takes one keystroke to reach, because entering
// the reading is the operation that happens every week and everything else on
// this surface happens once.
//
// So the reading is edited in the row itself rather than behind a composer, and
// writing it stamps the time. The rest of the condition — what it requires,
// which way, in what unit — is written once when the condition is set and is
// not editable here: those come from outside the Campaign, and a condition that
// turns out to be wrong is a different condition, not an edited one.
// =============================================================

/** One `intents` row per condition, hung under the Campaign's root Intent
 *  beside the decisions and the assumptions. */
export function CampaignMeasures({ campaign }: { campaign: CampaignIntentState }) {
  const { campaignId, data, error, refetch, ensureRoot } = campaign;

  // Written values, laid over the fetched rows. Not cleared on success — the
  // value here *is* what the server holds, so dropping it before the refetch
  // lands would flash the old reading back. A failed write puts the previous
  // value back and surfaces the row again.
  const [edits, setEdits] = useState<Record<string, Partial<Intent>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [unit, setUnit] = useState('');
  const [reading, setReading] = useState('');
  const [direction, setDirection] = useState<MeasureDirection | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  const measures = useMemo(() => {
    const rows = (data?.subs ?? [])
      .filter((i) => isMeasure(i.kind) && !removed.has(i.id))
      .map((i) => ({ ...i, ...edits[i.id] }));
    return orderMeasures(
      rows.map((i) => ({
        id: i.id,
        title: i.title,
        target: i.target_value ?? null,
        actual: i.actual_value ?? null,
        unit: i.unit ?? null,
        direction: i.direction ?? null,
        measuredAt: i.measured_at ?? null,
        orderIndex: i.order_index ?? 0,
      })),
    );
  }, [data?.subs, edits, removed]);

  const tally = tallyMeasures(measures);

  const parsedTarget = parseMeasureValue(target);
  const parsedReading = parseMeasureValue(reading);
  const submittable =
    title.trim().length > 0 &&
    direction !== null &&
    parsedTarget.ok &&
    parsedTarget.value !== null &&
    parsedReading.ok;

  async function record() {
    if (!submittable || saving) return;
    // Re-parsed rather than narrowed from `submittable`: the flag is a boolean
    // and cannot carry the values through to the insert.
    const parsedT = parseMeasureValue(target);
    const parsedR = parseMeasureValue(reading);
    if (!parsedT.ok || parsedT.value === null || !parsedR.ok || direction === null) return;
    setSaving(true);
    setFailure(null);
    try {
      const parent = await ensureRoot();
      await createIntent({
        strategy_id: campaignId,
        parent_intent_id: parent,
        kind: 'measure',
        title: title.trim(),
        target_value: parsedT.value,
        actual_value: parsedR.value,
        unit: unit.trim() || null,
        direction,
        measured_at: parsedR.value === null ? null : new Date().toISOString(),
        status: 'on_track',
        order_index: (data?.subs.length ?? 0) + 1,
      });
      // The condition clears; the unit and the direction do not. Conditions
      // arrive as a list from one document and most of a list shares both, so
      // re-picking them per row is the part that gets skipped.
      setTitle('');
      setTarget('');
      setReading('');
      refetch();
      titleRef.current?.focus();
    } catch (e) {
      console.error('record measure failed:', e);
      setFailure('Could not record the condition. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  }

  /** The frequent one. The reading and its timestamp move together — a number
   *  with no time on it cannot be shown to be current — and both roll back
   *  together, so a failed write never leaves the row wearing a reading the
   *  server does not hold. */
  async function setReadingOn(id: string, value: number | null) {
    const previous = edits[id];
    const measuredAt = value === null ? null : new Date().toISOString();
    setEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], actual_value: value, measured_at: measuredAt },
    }));
    setFailure(null);
    try {
      await updateIntent(id, { actual_value: value, measured_at: measuredAt });
      refetch();
    } catch (e) {
      console.error('update measure reading failed:', e);
      setEdits((prev) => {
        const next = { ...prev };
        if (previous) next[id] = previous;
        else delete next[id];
        return next;
      });
      setFailure('Could not save the reading. The condition still shows the last one.');
    }
  }

  async function remove(id: string) {
    setRemoved((prev) => new Set(prev).add(id));
    setFailure(null);
    try {
      await deleteIntent(id);
      refetch();
    } catch (e) {
      console.error('delete measure failed:', e);
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFailure('Could not delete the condition. It is still recorded.');
    }
  }

  return (
    <section>
      <div className="h-px bg-border mb-3" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-medium text-foreground/90">Measures</h2>
        <div className="flex items-center gap-2">
          {/* The reason this section exists: one glance answers whether the
              Campaign is meeting the conditions it is held to. */}
          {tally.total > 0 && (
            <span className={`text-[11px] tabular-nums ${tallyTone(tally.missed, tally.met, tally.total)}`}>
              {tally.met}/{tally.total} met
            </span>
          )}
          {/* Held until the fetch lands, for the same reason the other two
              composers are: the root Intent is created only when this Campaign
              has none, and that is not known yet. */}
          <button
            type="button"
            aria-label="Record a condition"
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
          Could not read this Campaign&apos;s conditions.
        </p>
      ) : !data ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">Reading the record…</p>
      ) : measures.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          Nothing here says what winning is — write the numbers this Campaign is held to, and the
          board can tell you whether it is meeting them.
        </p>
      ) : (
        <div className="flex flex-col">
          {measures.map((measure) => (
            <MeasureRow
              key={measure.id}
              measure={measure}
              onReading={(value) => void setReadingOn(measure.id, value)}
              onDelete={() => void remove(measure.id)}
            />
          ))}
        </div>
      )}

      {composing && (
        <Composer
          titleRef={titleRef}
          title={title}
          target={target}
          unit={unit}
          reading={reading}
          direction={direction}
          saving={saving}
          submittable={submittable}
          onTitle={setTitle}
          onTarget={setTarget}
          onUnit={setUnit}
          onReading={setReading}
          onDirection={setDirection}
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

/** The one field style, shared with the other two Campaign composers. No ring,
 *  no border, no outline (DESIGN.md §5.3) — the focused field is the one
 *  carrying a ground, and the negative margin keeps that ground from shifting
 *  the text sideways when it appears. */
const FIELD = [
  'w-full bg-transparent border-none text-foreground',
  'rounded-sm px-1 -mx-1 transition-colors',
  'focus:bg-[var(--surface-strong)]',
].join(' ');

// =============================================================
// A row. The condition, then the pair of numbers it is judged by, then when
// the reading was taken. The reading is an input rather than text because it
// is the only thing here that changes weekly.
// =============================================================
function MeasureRow({
  measure,
  onReading,
  onDelete,
}: {
  measure: Measure;
  onReading: (value: number | null) => void;
  onDelete: () => void;
}) {
  const required = targetLabel(measure);
  const requires = targetSentence(measure);
  const measured = formatElementDate(measure.measuredAt);

  return (
    <div className="py-2 border-b border-border/40 last:border-b-0">
      <div className="flex items-center gap-2">
        <span
          className="size-1.5 rounded-full shrink-0"
          style={{ background: stateVar(measure.state) }}
          aria-hidden
        />
        <span className="text-[13px] font-[550] text-foreground truncate min-w-0 flex-1">
          {measure.title}
        </span>

        {/* Only a condition that is not being met says anything. One that is
            holding has no news, and a badge on it would spend the reader's
            attention on the rows that did not change. */}
        {!measure.met && (
          <span
            className={`text-[11px] font-medium shrink-0 ${stateTone(measure.state)}`}
          >
            {measureStateLabel(measure.state)}
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Options for ${measure.title}`}
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
              Delete condition
            </DropdownMenuItem>
          </MenuShell>
        </DropdownMenu>
      </div>

      {/* The two numbers, adjacent, in the order the question is asked: what
          it is, then what it has to be. Apart they are a paragraph in a
          description and a sentence in a comment thread, which is the whole
          reason a Campaign could not say whether it was winning.

          They are separated by a dot rather than butted together, because
          `71% ≥ 80%` reads as a comparison somebody asserted, and the label
          keeps the second number from being read as the first one's operator. */}
      <div className="flex items-center gap-1 pl-3.5 mt-0.5 text-[12px]">
        <span className="text-[var(--text-tertiary)]">Reading</span>
        <span className="flex items-center">
          <ReadingField measure={measure} onCommit={onReading} />
          {measure.unit && <span className="text-muted-foreground">{measure.unit}</span>}
        </span>
        <span className="text-muted-foreground/40 px-0.5" aria-hidden>
          ·
        </span>
        <span className="text-[var(--text-tertiary)]">Target</span>
        <span
          className="text-muted-foreground tabular-nums"
          title={requires ? `Requires ${requires}` : 'This condition names no number'}
        >
          {required ?? '—'}
        </span>
      </div>

      {/* When the number was read. Said out loud even when it was never read,
          the same way a decision with no review date says so: a condition
          nobody has measured is not a passing one, and an empty line would
          leave it looking like one. */}
      <p className="text-[11px] text-muted-foreground/70 pl-3.5 mt-0.5">
        {measure.state === 'unstated' ? (
          <span className="text-muted-foreground/50">
            Nothing to measure against — this condition names no number, or no side of it.
          </span>
        ) : measured ? (
          `Measured ${measured}`
        ) : (
          <span className="text-muted-foreground/50">Nobody has read this yet</span>
        )}
      </p>
    </div>
  );
}

// =============================================================
// The reading. Editable where it is read, because entering it is the operation
// that repeats and a composer would put two clicks in front of a number
// somebody already has in their hand.
// =============================================================
function ReadingField({
  measure,
  onCommit,
}: {
  measure: Measure;
  onCommit: (value: number | null) => void;
}) {
  // Null means "not being edited", which is what lets an optimistic write show
  // through the moment it lands instead of being masked by a stale draft.
  const [draft, setDraft] = useState<string | null>(null);
  // Escape is a cancel, so it must not arrive at the blur that saves. The flag
  // is what keeps the two paths apart.
  const cancelling = useRef(false);
  const stored = measure.actual === null ? '' : String(measure.actual);

  function commit() {
    if (draft === null) return;
    const parsed = parseMeasureValue(draft);
    // Cleared either way: a refused entry falls back to the stored reading
    // rather than sitting in the field looking saved.
    setDraft(null);
    if (!parsed.ok || parsed.value === measure.actual) return;
    onCommit(parsed.value);
  }

  return (
    <input
      value={draft ?? stored}
      inputMode="decimal"
      placeholder="—"
      aria-label={`Reading for ${measure.title}`}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          cancelling.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (cancelling.current) {
          cancelling.current = false;
          return;
        }
        commit();
      }}
      className={[
        // Right-aligned and narrow so the number sits against its unit however
        // many digits it has, instead of drifting away from it.
        'w-10 text-right bg-transparent border-none rounded-sm px-1 transition-colors',
        'text-[12px] tabular-nums text-foreground',
        // The resting ground says it is editable; the focus ground says it is
        // being edited. No ring anywhere (DESIGN.md §5.3).
        'hover:bg-[var(--surface-raised)] focus:bg-[var(--surface-strong)]',
      ].join(' ')}
    />
  );
}

// =============================================================
// The composer. What the condition is, which way it runs, the number, the unit
// — and the reading, if whoever is writing it down already has one.
// =============================================================
function Composer({
  titleRef,
  title,
  target,
  unit,
  reading,
  direction,
  saving,
  submittable,
  onTitle,
  onTarget,
  onUnit,
  onReading,
  onDirection,
  onSubmit,
  onClose,
}: {
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
  title: string;
  target: string;
  unit: string;
  reading: string;
  direction: MeasureDirection | null;
  saving: boolean;
  submittable: boolean;
  onTitle: (v: string) => void;
  onTarget: (v: string) => void;
  onUnit: (v: string) => void;
  onReading: (v: string) => void;
  onDirection: (v: MeasureDirection) => void;
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
        ref={titleRef}
        value={title}
        rows={1}
        autoFocus
        onChange={(e) => onTitle(e.target.value)}
        placeholder="What this Campaign is held to"
        className={`${FIELD} text-[13px] leading-relaxed resize-none`}
      />
      <div className="flex items-center gap-2">
        {/* Neither direction is preselected. Zero unclosed corrections and a
            hundred percent trained are both full marks, and a default here
            would silently assign one of them the wrong meaning. */}
        {MEASURE_DIRECTIONS.map((d) => (
          <Button
            key={d}
            variant={direction === d ? 'secondary' : 'ghost'}
            size="xs"
            aria-pressed={direction === d}
            onClick={() => onDirection(d)}
          >
            {directionLabel(d)}
          </Button>
        ))}
        <input
          value={target}
          inputMode="decimal"
          onChange={(e) => onTarget(e.target.value)}
          placeholder="Target"
          aria-label="Target"
          className={`${FIELD} w-20 text-[12px] tabular-nums`}
        />
        <input
          value={unit}
          onChange={(e) => onUnit(e.target.value)}
          placeholder="Unit"
          aria-label="Unit"
          className={`${FIELD} w-20 text-[12px]`}
        />
      </div>
      <input
        value={reading}
        inputMode="decimal"
        onChange={(e) => onReading(e.target.value)}
        placeholder="Reading, if there is one yet"
        aria-label="Reading"
        className={`${FIELD} text-[12px] tabular-nums`}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X size={14} />
          Cancel
        </Button>
        <Button variant="primary" size="sm" disabled={!submittable || saving} onClick={onSubmit}>
          {saving ? 'Recording…' : 'Record'}
        </Button>
      </div>
    </div>
  );
}

/** The severity ramp, not the Element status ramp: a condition set outside the
 *  Campaign and not being met is the same claim a danger badge makes. */
function stateVar(state: MeasureState): string {
  switch (state) {
    case 'missed':
      return 'var(--status-danger)';
    case 'unmeasured':
      return 'var(--status-warning)';
    case 'unstated':
      return 'var(--text-tertiary)';
    default:
      return 'var(--status-success)';
  }
}

function stateTone(state: MeasureState): string {
  switch (state) {
    case 'missed':
      return 'text-[var(--status-danger)]';
    case 'unmeasured':
      return 'text-[var(--status-warning)]';
    default:
      return 'text-muted-foreground/70';
  }
}

/**
 * The tone of the count in the header.
 *
 * Three readings, because they ask for three different things. Something is
 * failing now; nothing is failing but not everything has been read; everything
 * is met. A count that stayed one colour would let two unread conditions look
 * the same as two failing ones, which is the confusion this whole section was
 * built to remove.
 */
function tallyTone(missed: number, met: number, total: number): string {
  if (missed > 0) return 'text-[var(--status-danger)]';
  if (met < total) return 'text-[var(--status-warning)]';
  return 'text-muted-foreground';
}
