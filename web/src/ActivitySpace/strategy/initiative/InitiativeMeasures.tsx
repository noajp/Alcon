"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, X } from '@/ui/icons';
import {
  createIntent,
  deleteIntent,
  updateIntent,
  type IntentBundle,
} from "@/hooks/useSupabase";
import type {
  Intent,
  IntentMeasureReading,
  IntentUpdate,
  MeasureDirection,
} from "@/types/database";
import { useMeasureReadings } from "@/hooks/useMeasureReadings";
import { Button, ButtonAppearanceProvider } from "@/ui/button";
import { useI18n } from "@/Function/i18n/I18nProvider";
import { MenuShell, MENU_ROW } from "@/Function/shared/menu";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { formatElementDate } from "@/Function/shared/dateUtils";
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
} from "@/ActivitySpace/strategy/initiative/initiativeMeasureModel";
import type { InitiativeIntentState } from "@/hooks/useInitiativeIntent";
import { WidgetHeaderAction } from "@/Function/widget";

/** Conditions and readings are editable Intent data shared by Measures, OKR and Gap. */
export function InitiativeMeasures({
  initiative,
  inlineHeader = false,
}: {
  initiative: InitiativeIntentState;
  inlineHeader?: boolean;
}) {
  return (
    <InitiativeMeasuresContent
      key={initiative.initiativeId}
      initiative={initiative}
      inlineHeader={inlineHeader}
    />
  );
}

function InitiativeMeasuresContent({
  initiative,
  inlineHeader,
}: {
  initiative: InitiativeIntentState;
  inlineHeader: boolean;
}) {
  const { initiativeId, data, error, refetch, ensureRoot } = initiative;
  const { t } = useI18n();
  const qc = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Measure | null>(null);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [reading, setReading] = useState("");
  const [direction, setDirection] = useState<MeasureDirection | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Measure | null>(null);
  const pending = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // Only server-confirmed values enter the shared cache. There is no permanent
  // component overlay that can hide an AI edit or another widget's changes.
  async function confirmed(row: Intent | null, deletedId?: string) {
    const queryKey = ["strategy-intent-bundle", initiativeId];
    await qc.cancelQueries({ queryKey });
    qc.setQueryData<IntentBundle>(queryKey, (previous) => {
      if (!previous) return previous;
      const subs = previous.subs.filter((intent) => intent.id !== deletedId);
      if (!row) return { ...previous, subs };
      return {
        ...previous,
        subs: subs.some((intent) => intent.id === row.id)
          ? subs.map((intent) => (intent.id === row.id ? row : intent))
          : [...subs, row],
      };
    });
    void qc.invalidateQueries({ queryKey: ["initiative-measures"] });
    // The database appended a reading if the value changed.
    if (row) void qc.invalidateQueries({ queryKey: ["measure-readings", row.id] });
    refetch();
  }
  const measures = useMemo(
    () =>
      orderMeasures(
        (data?.subs ?? [])
          .filter((i) => isMeasure(i.kind))
          .map((i) => ({
            id: i.id,
            title: i.title,
            target: i.target_value ?? null,
            actual: i.actual_value ?? null,
            unit: i.unit ?? null,
            direction: i.direction ?? null,
            measuredAt: i.measured_at ?? null,
            orderIndex: i.order_index ?? 0,
          })),
      ),
    [data?.subs],
  );
  const tally = tallyMeasures(measures);
  const parsedTarget = parseMeasureValue(target);
  const parsedReading = parseMeasureValue(reading);
  const submittable =
    title.trim().length > 0 &&
    direction !== null &&
    parsedTarget.ok &&
    parsedTarget.value !== null &&
    parsedReading.ok;

  function openEdit(measure: Measure) {
    if (pending.current || composing) return;
    setEditing(measure);
    setTitle(measure.title);
    setTarget(measure.target === null ? "" : String(measure.target));
    setUnit(measure.unit ?? "");
    setReading(measure.actual === null ? "" : String(measure.actual));
    setDirection(measure.direction);
    setComposing(true);
    setDeleting(null);
    setFailure(null);
  }
  function openCreate() {
    if (pending.current || composing) return;
    if (editing) {
      setTitle("");
      setTarget("");
      setUnit("");
      setReading("");
      setDirection(null);
    }
    setEditing(null);
    setComposing(true);
    setDeleting(null);
    setFailure(null);
  }
  async function record() {
    if (!submittable || pending.current) return;
    const parsedT = parseMeasureValue(target);
    const parsedR = parseMeasureValue(reading);
    if (
      !parsedT.ok ||
      parsedT.value === null ||
      !parsedR.ok ||
      direction === null
    )
      return;
    pending.current = true;
    setSaving(true);
    setFailure(null);
    try {
      if (editing) {
        // Unchanged fields are not re-sent: an updated reading from another
        // surface must survive a title-only edit made from an older draft.
        const patch: IntentUpdate = {};
        if (title.trim() !== editing.title) patch.title = title.trim();
        if (parsedT.value !== editing.target)
          patch.target_value = parsedT.value;
        if ((unit.trim() || null) !== editing.unit)
          patch.unit = unit.trim() || null;
        if (direction !== editing.direction) patch.direction = direction;
        if (parsedR.value !== editing.actual) {
          patch.actual_value = parsedR.value;
          patch.measured_at =
            parsedR.value === null ? null : new Date().toISOString();
        }
        if (Object.keys(patch).length)
          await confirmed(await updateIntent(editing.id, patch, "manual"));
        setComposing(false);
      } else {
        const parent = await ensureRoot();
        const row = await createIntent({
          strategy_id: initiativeId,
          parent_intent_id: parent,
          kind: "measure",
          title: title.trim(),
          target_value: parsedT.value,
          actual_value: parsedR.value,
          unit: unit.trim() || null,
          direction,
          measured_at: parsedR.value === null ? null : new Date().toISOString(),
          status: "on_track",
          order_index:
            Math.max(0, ...(data?.subs ?? []).map((i) => i.order_index ?? 0)) +
            1,
        }, "manual");
        await confirmed(row);
        setTitle("");
        setTarget("");
        setReading("");
        // Repeated entry keeps the common unit and direction.
        requestAnimationFrame(() => titleRef.current?.focus());
      }
    } catch (e) {
      console.error("save measure failed:", e);
      setFailure(
        t("Could not save the condition. Your draft is kept; try saving again."),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function setReadingOn(id: string, value: number | null) {
    if (pending.current)
      throw new Error(t("A change is still saving. Try again when it finishes."));
    pending.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await confirmed(
        await updateIntent(
          id,
          {
            actual_value: value,
            measured_at: value === null ? null : new Date().toISOString(),
          },
          "manual",
        ),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function remove() {
    if (!deleting || pending.current) return;
    pending.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await deleteIntent(deleting.id);
      await confirmed(null, deleting.id);
      setDeleting(null);
    } catch (e) {
      console.error("delete measure failed:", e);
      setFailure(t("Could not delete the condition. Try again."));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const header = (
    <div className="flex items-center gap-2">
      {tally.total > 0 && (
        <span
          className={`text-xs tabular-nums ${tallyTone(tally.missed, tally.met, tally.total)}`}
        >
          {t("{met}/{total} met", { met: tally.met, total: tally.total })}
        </span>
      )}
      <ButtonAppearanceProvider appearance="inline">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!data || saving || composing || !initiative.canEdit}
          title={initiative.lockReason ?? undefined}
          onClick={openCreate}
        >
          <Plus size={12} />
          {t("Add condition")}
        </Button>
      </ButtonAppearanceProvider>
    </div>
  );
  return (
    <>
      {inlineHeader ? (
        <div className="flex items-center justify-between py-2">
          <span className="text-sm font-medium">{t("Conditions")}</span>
          {header}
        </div>
      ) : (
        <WidgetHeaderAction>{header}</WidgetHeaderAction>
      )}
      {failure && (
        <p role="alert" className="py-1 text-xs text-[var(--status-danger)]">
          {failure}
        </p>
      )}
      {error ? (
        <p role="alert" className="py-1 text-xs text-[var(--status-danger)]">
          {t("Could not read this Strategy's conditions.")}
          <Button variant="ghost" size="xs" onClick={refetch}>
            {t("Retry")}
          </Button>
        </p>
      ) : !data ? (
        <p role="status" className="py-1 text-xs text-muted-foreground">
          {t("Loading conditions…")}
        </p>
      ) : measures.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">
          {t("Add a condition with a target, unit and reading to track this Strategy's success.")}
        </p>
      ) : (
        <div className="flex flex-col">
          {measures.map((measure) => (
            <MeasureRow
              key={measure.id}
              measure={measure}
              disabled={saving || composing || deleting !== null || !initiative.canEdit}
              onReading={(value) => setReadingOn(measure.id, value)}
              onEdit={() => openEdit(measure)}
              onDelete={() => {
                setDeleting(measure);
                setFailure(null);
              }}
            />
          ))}
        </div>
      )}
      {deleting && (
        <div
          className="mt-2 space-y-2 py-1"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (!pending.current) setDeleting(null);
            }
          }}
        >
          <p className="text-sm">{t("Delete “{title}” and its reading?", { title: deleting.title })}</p>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={saving}
              onClick={() => void remove()}
            >
              {saving ? t("Deleting…") : t("Delete condition")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => setDeleting(null)}
            >
              {t("Cancel")}
            </Button>
          </div>
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
          editing={editing !== null}
          saving={saving}
          submittable={submittable}
          onTitle={setTitle}
          onTarget={setTarget}
          onUnit={setUnit}
          onReading={setReading}
          onDirection={setDirection}
          onSubmit={() => void record()}
          onClose={() => {
            if (!pending.current) {
              setComposing(false);
              setFailure(null);
            }
          }}
        />
      )}
    </>
  );
}

const FIELD =
  "w-full min-w-0 h-8 bg-transparent text-foreground rounded-sm px-2 text-sm hover:bg-muted/40 focus:bg-[var(--surface-strong)] disabled:opacity-50";

function MeasureRow({
  measure,
  disabled,
  onReading,
  onEdit,
  onDelete,
}: {
  measure: Measure;
  disabled: boolean;
  onReading: (value: number | null) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [showHistory, setShowHistory] = useState(false);
  const required = targetLabel(measure);
  const requires = targetSentence(measure);
  const measured = formatElementDate(measure.measuredAt);
  // A flat row: the whole row is the hover target, and its two controls
  // appear with it instead of standing on every line.
  const reveal = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100";
  return (
    <div className="group -mx-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
      <div className="flex items-start gap-2">
        <span
          className="mt-2 size-2 shrink-0 rounded-full"
          style={{ background: stateVar(measure.state) }}
          aria-hidden
        />
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">
          {measure.title}
        </span>
        {!measure.met && (
          <span className={`shrink-0 text-xs ${stateTone(measure.state)}`}>
            {measureStateLabel(measure.state)}
          </span>
        )}
        <ButtonAppearanceProvider appearance="navigation">
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={onEdit}
          aria-label={t("Edit {title}", { title: measure.title })}
          className={reveal}
        >
          {t("Edit")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={t("Options for {title}", { title: measure.title })}
              className={reveal}
            >
              <MoreHorizontal size={12} />
            </Button>
          </DropdownMenuTrigger>
          <MenuShell as="dropdown" width="standard" align="end">
            <DropdownMenuItem
              onSelect={onDelete}
              className={`${MENU_ROW} text-[var(--status-danger)]`}
            >
              {t("Delete condition")}
            </DropdownMenuItem>
          </MenuShell>
        </DropdownMenu>
        </ButtonAppearanceProvider>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-xs">
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="text-muted-foreground">{t("Reading")}</span>
          <ReadingField
            measure={measure}
            disabled={disabled}
            onCommit={onReading}
          />
          {measure.unit && (
            <span className="break-all text-muted-foreground">
              {measure.unit}
            </span>
          )}
        </span>
        <span
          className="min-w-0 break-words text-muted-foreground"
          title={
            requires ? t("Requires {target}", { target: requires }) : t("This condition names no number")
          }
        >
          {t("Target")} <span className="tabular-nums">{required ?? "—"}</span>
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 pl-4 text-xs text-muted-foreground">
        <span>
          {measure.state === "unstated"
            ? t("Set a target and direction to evaluate this condition.")
            : measured
              ? t("Measured {date}", { date: measured })
              : t("No reading yet")}
        </span>
        <ButtonAppearanceProvider appearance="inline">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={showHistory}
            aria-label={t("Reading history for {title}", { title: measure.title })}
            onClick={() => setShowHistory((open) => !open)}
          >
            {showHistory ? t("Hide reading history") : t("Reading history")}
          </Button>
        </ButtonAppearanceProvider>
      </div>
      {showHistory && <ReadingHistory measure={measure} />}
    </div>
  );
}

/** Every reading of one condition, newest first, as the database kept them. */
function ReadingHistory({ measure }: { measure: Measure }) {
  const { t } = useI18n();
  const { data, error, isPending, refetch } = useMeasureReadings(measure.id, true);
  if (error)
    return (
      <p role="alert" className="mt-1 pl-4 text-xs text-[var(--status-danger)]">
        {t("Could not read the reading history.")}
        <Button variant="ghost" size="xs" onClick={() => void refetch()}>
          {t("Retry")}
        </Button>
      </p>
    );
  if (isPending)
    return (
      <p role="status" className="mt-1 pl-4 text-xs text-muted-foreground">
        {t("Loading readings…")}
      </p>
    );
  if (data.length === 0)
    return (
      <p className="mt-1 pl-4 text-xs text-muted-foreground">
        {t("No readings recorded yet.")}
      </p>
    );
  return (
    <ol className="mt-1 flex flex-col gap-1 pl-4 text-xs">
      {data.map((reading) => (
        <li key={reading.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="tabular-nums text-muted-foreground">
            {formatElementDate(reading.measured_at ?? reading.recorded_at) ?? "—"}
          </span>
          <span className="tabular-nums text-foreground">
            {reading.value === null
              ? t("Reading cleared")
              : `${reading.value}${reading.unit ? ` ${reading.unit}` : ""}`}
          </span>
          <span className="min-w-0 break-words text-muted-foreground">
            {[reading.recorded_by_name, readingSourceLabel(reading.source, t)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </li>
      ))}
    </ol>
  );
}

function readingSourceLabel(
  source: IntentMeasureReading["source"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (source) {
    case "manual":
      return t("Entered by hand");
    case "copilot":
      return t("By Copilot");
    case "api":
      return t("Via API");
    case "mcp":
      return t("Via MCP");
    case "agent":
      return t("By an agent");
    case "system":
      return t("By the system");
    case "backfill":
      return t("Before history was kept");
    default:
      return t("Other source");
  }
}

function ReadingField({
  measure,
  disabled,
  onCommit,
}: {
  measure: Measure;
  disabled: boolean;
  onCommit: (value: number | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const cancelling = useRef(false);
  const stored = measure.actual === null ? "" : String(measure.actual);
  async function commit() {
    if (draft === null || pending.current) return;
    const parsed = parseMeasureValue(draft);
    if (!parsed.ok) {
      setFailure(t("Enter a finite number."));
      return;
    }
    if (parsed.value === measure.actual) {
      setDraft(null);
      setFailure(null);
      return;
    }
    pending.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await onCommit(parsed.value);
      setDraft(null);
    } catch (e) {
      setFailure(
        e instanceof Error ? e.message : t("Could not save. Your draft is kept."),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <span className="inline-flex max-w-full flex-col items-start">
      <input
        value={draft ?? stored}
        inputMode="decimal"
        placeholder="—"
        aria-label={t("Reading for {title}", { title: measure.title })}
        aria-invalid={!!failure}
        disabled={disabled || saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            cancelling.current = true;
            setDraft(null);
            setFailure(null);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (cancelling.current) {
            cancelling.current = false;
            return;
          }
          void commit();
        }}
        style={{ width: `${Math.max(10, (draft ?? stored).length + 2)}ch` }}
        className="h-8 max-w-full rounded-sm bg-transparent px-2 text-right text-sm tabular-nums text-foreground hover:bg-[var(--surface-raised)] focus:bg-[var(--surface-strong)] disabled:opacity-50"
      />
      {saving && (
        <span role="status" className="text-xs text-muted-foreground">
          {t("Saving…")}
        </span>
      )}
      {failure && (
        <span role="alert" className="text-xs text-[var(--status-danger)]">
          {failure}
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || saving}
            onClick={() => void commit()}
          >
            {t("Retry")}
          </Button>
        </span>
      )}
    </span>
  );
}

function Composer({
  titleRef,
  title,
  target,
  unit,
  reading,
  direction,
  editing,
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
  editing: boolean;
  saving: boolean;
  submittable: boolean;
  onTitle: (value: string) => void;
  onTarget: (value: string) => void;
  onUnit: (value: string) => void;
  onReading: (value: string) => void;
  onDirection: (value: MeasureDirection) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const targetResult = parseMeasureValue(target);
  const readingResult = parseMeasureValue(reading);
  return (
    <form
      className="mt-2 space-y-3 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (!saving) onClose();
        }
      }}
    >
      <p className="text-sm font-medium">
        {editing ? t("Edit condition") : t("Add condition")}
      </p>
      <label className="block text-xs text-muted-foreground">
        {t("Condition")}
        <textarea
          ref={titleRef}
          value={title}
          rows={2}
          autoFocus
          disabled={saving}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={t("What this Strategy is held to")}
          className={`${FIELD} h-auto resize-none py-2`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("Direction")}</span>
        {MEASURE_DIRECTIONS.map((d) => (
          <Button
            key={d}
            type="button"
            variant={direction === d ? "secondary" : "ghost"}
            size="xs"
            disabled={saving}
            aria-pressed={direction === d}
            onClick={() => onDirection(d)}
          >
            {directionLabel(d)}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="min-w-0 text-xs text-muted-foreground">
          {t("Target")}
          <input
            value={target}
            inputMode="decimal"
            disabled={saving}
            onChange={(e) => onTarget(e.target.value)}
            aria-label={t("Target")}
            aria-invalid={!targetResult.ok}
            className={`${FIELD} tabular-nums`}
          />
        </label>
        <label className="min-w-0 text-xs text-muted-foreground">
          {t("Unit")}
          <input
            value={unit}
            disabled={saving}
            onChange={(e) => onUnit(e.target.value)}
            aria-label={t("Unit")}
            placeholder={t("Optional")}
            className={FIELD}
          />
        </label>
      </div>
      <label className="block text-xs text-muted-foreground">
        {t("Reading")}
        <input
          value={reading}
          inputMode="decimal"
          disabled={saving}
          onChange={(e) => onReading(e.target.value)}
          placeholder={t("Not measured yet")}
          aria-label={t("Reading")}
          aria-invalid={!readingResult.ok}
          className={`${FIELD} tabular-nums`}
        />
      </label>
      {(!targetResult.ok || !readingResult.ok) && (
        <p role="alert" className="text-xs text-[var(--status-danger)]">
          {t("Use finite numbers for the target and reading.")}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onClose}
        >
          <X size={14} />
          {t("Cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!submittable || saving}
        >
          {saving ? t("Saving…") : editing ? t("Save condition") : t("Add condition")}
        </Button>
      </div>
    </form>
  );
}

/** The severity ramp, not the Element status ramp: a condition set outside the
 *  Strategy and not being met is the same claim a danger badge makes. */
function stateVar(state: MeasureState): string {
  switch (state) {
    case "missed":
      return "var(--status-danger)";
    case "unmeasured":
      return "var(--status-warning)";
    case "unstated":
      return "var(--text-tertiary)";
    default:
      return "var(--status-success)";
  }
}

function stateTone(state: MeasureState): string {
  switch (state) {
    case "missed":
      return "text-[var(--status-danger)]";
    case "unmeasured":
      return "text-[var(--status-warning)]";
    default:
      return "text-muted-foreground/70";
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
  if (missed > 0) return "text-[var(--status-danger)]";
  if (met < total) return "text-[var(--status-warning)]";
  return "text-muted-foreground";
}
