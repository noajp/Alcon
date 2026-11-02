// =============================================================
// Initiative measures — the number the condition names, the number somebody
// read, and whether one meets the other.
//
// Three tabletop exercises wrote their success conditions into a Initiative
// description and then watched the board fail to read them. The third made it
// undeniable: an accreditation review whose conditions were five numbers set by
// somebody outside the Initiative — hand hygiene at or above 80%, discharge
// summaries at or above 90%, mandatory training at 100%, falls assessment at or
// above 95%, unclosed safety corrections at zero. The weekly readings came back
// in the same units. Three of the five were already failing and the board knew
// none of it, because a target written in prose and a reading written in prose
// cannot be subtracted from each other.
//
// So the judgement lives here, on numbers, and it is three-valued rather than
// two. A condition nobody has read is not a condition that is failing — it is
// one nobody can speak for, which is a different sentence and needs a different
// answer. Collapsing the two would let a Initiative report a miss it never
// observed, or a pass it never earned.
//
// `direction` is read, never inferred. Zero unclosed corrections and one
// hundred percent trained are both full marks, and only the condition itself
// says which side of its number counts as met.
//
// Pure on purpose: no React, no Supabase, and no clock — nothing here judges
// the age of a reading, only whether the reading meets the condition.
// =============================================================

import type { IntentKind, MeasureDirection } from '@/types/database';
import { translate } from '@/Function/i18n/I18nProvider';

/** What marks an `intents` row as a measure rather than a decision or an
 *  assumption. All three hang off the Initiative's root Intent and arrive in the
 *  same query, so every surface reading that list filters on `kind`. */
export function isMeasure(kind: IntentKind | null | undefined): boolean {
  return kind === 'measure';
}

/** One `intents` row, narrowed to the columns a measure is made of. */
export interface MeasureInput {
  id: string;
  /** The condition as whoever set it wrote it. */
  title: string;
  /** The number the condition names. */
  target: number | null;
  /** The number somebody last read. Null until anyone has. */
  actual: number | null;
  /** The operator's unit — `%`, `件`, `世帯/日`. Never a closed set. */
  unit: string | null;
  direction: MeasureDirection | null;
  /** ISO timestamp of the reading. */
  measuredAt: string | null;
  orderIndex: number;
}

/**
 * Where a measure stands.
 *
 * `unmeasured` and `unstated` are both "cannot be judged", and they are kept
 * apart because the thing to do about them is different. An unmeasured
 * condition needs somebody to go and read a number. An unstated one is missing
 * half of itself — no target, or no direction — and needs the condition
 * rewritten. Reporting either as a miss would claim an observation nobody made.
 */
export type MeasureState = 'met' | 'missed' | 'unmeasured' | 'unstated';

export interface Measure extends MeasureInput {
  state: MeasureState;
  met: boolean;
}

const STATE_LABELS: Record<MeasureState, string> = {
  met: 'Met',
  missed: 'Missed',
  unmeasured: 'Not measured',
  unstated: 'No target set',
};

export function measureStateLabel(state: MeasureState): string {
  return translate(STATE_LABELS[state]);
}

/** Which side of the target counts. The one comparison this file exists for. */
export function meetsTarget(
  actual: number,
  target: number,
  direction: MeasureDirection,
): boolean {
  return direction === 'at_most' ? actual <= target : actual >= target;
}

/**
 * The reading against the condition.
 *
 * The condition is checked before the reading: a row with neither a target nor
 * an actual is reported as unstated rather than unmeasured, because measuring
 * it would not help — there is still nothing to measure it against.
 *
 * Non-finite numbers are treated as absent rather than compared. `numeric`
 * columns arrive as JavaScript numbers, and a NaN silently loses every
 * comparison, which would print as a miss nobody observed.
 */
export function measureState(input: MeasureInput): MeasureState {
  const target = input.target;
  if (target === null || !Number.isFinite(target) || input.direction === null) {
    return 'unstated';
  }
  const actual = input.actual;
  if (actual === null || !Number.isFinite(actual)) return 'unmeasured';
  return meetsTarget(actual, target, input.direction) ? 'met' : 'missed';
}

export function evaluateMeasure(input: MeasureInput): Measure {
  const state = measureState(input);
  return { ...input, state, met: state === 'met' };
}

/**
 * Failing first, unread second, met last.
 *
 * Four bands, ordered by what the reader has to do about them. A missed
 * condition is the only one already costing something, so it goes to the top.
 * Unread sits directly under it — an unmeasured condition is not a miss, but it
 * is a condition that could have been failing for six weeks with nobody able to
 * say so, which puts it far closer to a miss than to a pass. Unstated is a
 * defect in the record rather than in the work, so it comes after the rows that
 * are actually reporting on the work. Met is last, because a condition that is
 * holding is not news.
 *
 * Within the missed band nothing is ranked by how far off it is. The units are
 * the operator's — nine points of hand hygiene and three unclosed corrections
 * are not on one scale — and ordering them by magnitude would invent a
 * comparison the numbers do not support. The tie-break is the age of the
 * reading instead, stalest first, because that is the part that decays: a miss
 * measured in July and a miss measured this morning are different claims, and
 * a reading with no timestamp at all is the least trustworthy of the lot.
 */
export function orderMeasures(inputs: MeasureInput[]): Measure[] {
  return inputs
    .map(evaluateMeasure)
    .sort((a, b) => {
      const band = BAND[a.state] - BAND[b.state];
      if (band !== 0) return band;
      // Compared for equality before subtracting: two unread rows both rank
      // −Infinity, and subtracting those gives NaN, which leaves the whole
      // comparator undefined and the order arbitrary.
      const ra = readingRank(a);
      const rb = readingRank(b);
      if (ra !== rb) return ra < rb ? -1 : 1;
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      return a.id.localeCompare(b.id);
    });
}

const BAND: Record<MeasureState, number> = {
  missed: 0,
  unmeasured: 1,
  unstated: 2,
  met: 3,
};

/** Undated readings rank oldest rather than newest — a number with no time on
 *  it cannot be shown to be current. */
function readingRank(measure: Measure): number {
  if (!measure.measuredAt) return Number.NEGATIVE_INFINITY;
  const t = new Date(measure.measuredAt).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export interface MeasureTally {
  met: number;
  missed: number;
  unmeasured: number;
  unstated: number;
  total: number;
}

/** The count the section header carries. Every band is kept, not just the met
 *  one, so the header can tell "two are failing" apart from "two are unread"
 *  without recounting the rows. */
export function tallyMeasures(measures: Measure[]): MeasureTally {
  return {
    met: measures.filter((m) => m.state === 'met').length,
    missed: measures.filter((m) => m.state === 'missed').length,
    unmeasured: measures.filter((m) => m.state === 'unmeasured').length,
    unstated: measures.filter((m) => m.state === 'unstated').length,
    total: measures.length,
  };
}

export const MEASURE_DIRECTIONS: MeasureDirection[] = ['at_least', 'at_most'];

const DIRECTION_LABELS: Record<MeasureDirection, string> = {
  at_least: 'At least',
  at_most: 'At most',
};

export function directionLabel(direction: MeasureDirection): string {
  return translate(DIRECTION_LABELS[direction]);
}

/** The compact form the row prints. Carries the same fact as the label in a
 *  width that fits beside the number it qualifies. */
export function directionSymbol(direction: MeasureDirection): string {
  return direction === 'at_most' ? '≤' : '≥';
}

/**
 * A number in the operator's unit.
 *
 * The separator is decided by the unit, not by a setting: `%` and `件` and
 * `世帯/日` all attach to the number, and a word unit does not. So a unit
 * starting with a Latin letter takes a space and everything else does not,
 * which covers both without asking the author to think about it.
 */
export function formatMeasureValue(
  value: number | null,
  unit: string | null,
): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const trimmed = unit?.trim() ?? '';
  if (!trimmed) return String(value);
  return `${value}${/^[A-Za-z]/.test(trimmed) ? ' ' : ''}${trimmed}`;
}

/** What the condition requires, as one phrase: `≥ 80%`. Null when the row does
 *  not state a condition, which is the `unstated` band. */
export function targetLabel(measure: MeasureInput): string | null {
  if (measure.target === null || !Number.isFinite(measure.target)) return null;
  if (measure.direction === null) return null;
  return `${directionSymbol(measure.direction)} ${formatMeasureValue(measure.target, measure.unit)}`;
}

/** The same phrase spelled out, for the accessible name. `≥` is read aloud
 *  inconsistently and sometimes not at all. */
export function targetSentence(measure: MeasureInput): string | null {
  if (measure.target === null || !Number.isFinite(measure.target)) return null;
  if (measure.direction === null) return null;
  return translate(measure.direction === 'at_most' ? 'at most {value}' : 'at least {value}', { value: formatMeasureValue(measure.target, measure.unit) ?? '' });
}

export type ParsedValue = { ok: true; value: number | null } | { ok: false };

/**
 * What somebody typed into a number field.
 *
 * Blank is a value: it clears the reading back to "nobody has measured this",
 * which is the only way to undo a number entered by mistake without deleting
 * the condition. Anything that is not a finite number is refused rather than
 * coerced — `Number('')` is 0, and a stray keystroke saved as a reading of zero
 * would report a miss against a target nobody measured.
 */
export function parseMeasureValue(text: string): ParsedValue {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

// ── Lists ────────────────────────────────────────────────────────────────
// A list of Initiatives reads every measure in one query and splits it here,
// so the row can say "2 missed" without a query per row. An Initiative with no
// measure gets an empty tally rather than none at all: "no success conditions"
// is a fact about it, and an absent entry means only "not loaded yet".

export const EMPTY_TALLY: MeasureTally = { met: 0, missed: 0, unmeasured: 0, unstated: 0, total: 0 };

/** Every listed Initiative's tally from one batch of measures. Rows for
 *  Initiatives outside `initiativeIds` are ignored. */
export function talliesByInitiative(
  initiativeIds: string[],
  rows: Array<MeasureInput & { initiativeId: string }>,
): Map<string, MeasureTally> {
  const grouped = new Map<string, Measure[]>(initiativeIds.map((id) => [id, []]));
  for (const row of rows) grouped.get(row.initiativeId)?.push(evaluateMeasure(row));
  return new Map([...grouped].map(([id, measures]) => [id, tallyMeasures(measures)]));
}

export function addTallies(a: MeasureTally, b: MeasureTally): MeasureTally {
  return {
    met: a.met + b.met,
    missed: a.missed + b.missed,
    unmeasured: a.unmeasured + b.unmeasured,
    unstated: a.unstated + b.unstated,
    total: a.total + b.total,
  };
}

export type MeasureSummaryTone = 'none' | 'missed' | 'open' | 'met';

/**
 * What a list row prints for its success conditions, and how loudly.
 *
 * A miss or an unread condition is named by count against the total
 * ("2 missed · 1 not measured / 5"), because those are the ones somebody has
 * to act on. When neither is left the row reports the met share instead. The
 * tone follows the Measures section header, so the row and the page it opens
 * colour the same tally the same way: a miss is the alarm, anything short of
 * all-met is the caution, all-met is quiet.
 */
export function measureSummary(tally: MeasureTally): { text: string; tone: MeasureSummaryTone } {
  if (tally.total === 0) return { text: translate('No success conditions'), tone: 'none' };
  const parts: string[] = [];
  if (tally.missed > 0) parts.push(translate('{n} missed', { n: tally.missed }));
  if (tally.unmeasured > 0) parts.push(translate('{n} not measured', { n: tally.unmeasured }));
  const tone: MeasureSummaryTone = tally.missed > 0 ? 'missed' : tally.met < tally.total ? 'open' : 'met';
  if (parts.length === 0) return { text: translate('{met}/{total} met', { met: tally.met, total: tally.total }), tone };
  return { text: `${parts.join(' · ')} / ${tally.total}`, tone };
}

/** Every band spelled out, for the hover title. */
export function measureTallyDetail(tally: MeasureTally): string {
  return (['met', 'missed', 'unmeasured', 'unstated'] as const)
    .filter((state) => tally[state] > 0)
    .map((state) => `${measureStateLabel(state)} ${tally[state]}`)
    .join(' · ');
}
