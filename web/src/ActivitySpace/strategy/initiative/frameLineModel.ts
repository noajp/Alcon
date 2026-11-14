// The frame of a Strategy — what it takes to be true, what it is held to and
// what it has chosen — written as lines of its description.
//
// A line is a block of the description that points at an `intents` row: the
// sentence is kept once, on the row, and the description says where it
// stands. A line is first placed as a draft naming only its kind; the row is
// made when there is a sentence to keep, so a draft left empty leaves nothing
// behind. A row the description does not place is still part of the frame,
// and is listed after the description rather than hidden.
//
// Pure. No React, no Supabase.

import { embedSpecsIn, type EmbedSpec } from '@/Function/notebook/editor/embedBlocks';
import { formatMeasureValue } from './initiativeMeasureModel';

/** The view a frame line's block names. */
export const FRAME_VIEW = 'intent';

export type FrameKind = 'assumption' | 'measure' | 'decision';
export const FRAME_KINDS: readonly FrameKind[] = ['assumption', 'measure', 'decision'];

export function isFrameKind(kind: unknown): kind is FrameKind {
  return typeof kind === 'string' && (FRAME_KINDS as readonly string[]).includes(kind);
}

/** A line just placed: its kind, and no row yet. It carries a sentence only
 *  when one was written and its row could not be made — kept for the retry. */
export const draftFrameSpec = (kind: FrameKind, text?: string): EmbedSpec =>
  (text ? { view: FRAME_VIEW, kind, text } : { view: FRAME_VIEW, kind });
/** A line pointing at its row. */
export const boundFrameSpec = (id: string): EmbedSpec => ({ view: FRAME_VIEW, id });

export type FrameRef = { id: string } | { kind: FrameKind; text: string };

/** What a block of the frame points at: its row, or — not yet written — the
 *  kind it will be. Null for any other block, and for one naming neither. */
export function frameRef(spec: EmbedSpec): FrameRef | null {
  if (spec.view !== FRAME_VIEW) return null;
  if (typeof spec.id === 'string' && spec.id) return { id: spec.id };
  return isFrameKind(spec.kind) ? { kind: spec.kind, text: typeof spec.text === 'string' ? spec.text : '' } : null;
}

/** The rows a description places, each once, in the order it places them. */
export function placedFrameIds(markdown: string | null | undefined): string[] {
  const ids: string[] = [];
  for (const spec of embedSpecsIn(markdown)) {
    const ref = frameRef(spec);
    if (ref && 'id' in ref && !ids.includes(ref.id)) ids.push(ref.id);
  }
  return ids;
}

export interface FrameRow {
  id: string;
  kind: string;
  order_index?: number | null;
  superseded_by_intent_id?: string | null;
}

// What a reader arrives asking, outward in: whether the conditions are met,
// then what the plan takes as given, then what it chose on that ground.
const UNPLACED_ORDER: Record<FrameKind, number> = { measure: 0, assumption: 1, decision: 2 };

/**
 * The rows of the frame the description does not place, in reading order. A
 * decision another one replaced is the Strategy's history, not its frame, and
 * the root row is the Strategy itself: neither is listed.
 */
export function unplacedFrameRows<T extends FrameRow>(rows: readonly T[], placed: readonly string[]): T[] {
  const there = new Set(placed);
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isFrameKind(row.kind) && !row.superseded_by_intent_id && !there.has(row.id))
    .sort((a, b) =>
      UNPLACED_ORDER[a.row.kind as FrameKind] - UNPLACED_ORDER[b.row.kind as FrameKind]
      || (a.row.order_index ?? 0) - (b.row.order_index ?? 0)
      || a.index - b.index)
    .map(({ row }) => row);
}

export interface FrameBinding { intent_id: string; target_type: string; target_id: string }

/** How many Elements rest on a row. An Element bound to it twice — it both
 *  delivers and measures — is one Element. */
export function elementsOn(bindings: readonly FrameBinding[], intentId: string): number {
  const ids = new Set<string>();
  for (const b of bindings) if (b.intent_id === intentId && b.target_type === 'element') ids.add(b.target_id);
  return ids.size;
}

/** Where a success condition stands, as its line shows it: `3 / 10社`. Null
 *  when it names no target — there is nothing to stand against. */
export function measureStanding(row: { target_value?: number | null; actual_value?: number | null; unit?: string | null }): string | null {
  const target = formatMeasureValue(row.target_value ?? null, row.unit ?? null);
  if (target === null) return null;
  const actual = row.actual_value ?? null;
  return `${actual === null || !Number.isFinite(actual) ? '–' : String(actual)} / ${target}`;
}

/** The width, in em, of the widest of these labels: a full-width character is
 *  one em and anything else a little over half. Lines stand in separate
 *  blocks, so their sentences can only line up if every label takes the same
 *  room. */
export function labelColumnEm(labels: readonly string[]): number {
  const width = (label: string) => [...label].reduce((sum, ch) => sum + (/[⺀-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.58), 0);
  return Math.ceil(Math.max(0, ...labels.map(width)) * 10) / 10;
}
