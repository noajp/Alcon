// =============================================================
// A flow between any two or three dimensions of the same Elements.
//
// This began as Worker → Object → Initiative with the question welded in, which
// is the thing that made it a diagram of one sentence rather than a tool. The
// columns are dimensions now — the same vocabulary the Display menu groups a
// list by — so the figure answers "where are the people" and "which labels
// are stuck in which status" with the same code.
//
// One rule holds the arithmetic together: **an Element carries a weight of
// one, and a column that puts it in several buckets splits that weight.** A
// person on two Objects is half in each, not twice over. Without it the
// ribbons stop summing to the rows they came from and the figure quietly
// inflates the work that exists — six assignments leaving as ten.
//
// Pure on purpose: no React, no Supabase, no clock.
// =============================================================

import type { ElementWithDetails } from '@/types/database';
import {
  DIMENSION_LABEL,
  bucketsOf,
  type Dimension,
  type DimensionContext,
} from '@/alcon/shared/dimensions';

export interface FlowNode {
  id: string;
  /** Which dimension this column is, for colouring and for opening the row. */
  dimension: Dimension;
  /** The bucket's own id — an Object uuid, a status key, a label string. */
  entityId: string;
  label: string;
  value: number;
  column: number;
  /** 0–1 of the column's height, top edge. */
  offset: number;
  /** 0–1 of the column's height. */
  height: number;
}

export interface FlowLink {
  id: string;
  from: string;
  to: string;
  value: number;
  fromOffset: number;
  fromHeight: number;
  toOffset: number;
  toHeight: number;
}

export interface EffortFlow {
  nodes: FlowNode[];
  links: FlowLink[];
  /** The columns actually drawn — a dimension that collapses to one bucket is
   *  dropped, because a column every ribbon lands in says nothing. */
  columns: Dimension[];
  /** Elements counted. Node values sum to this per column, whatever the
   *  splitting did. */
  total: number;
}

/**
 * How many rows a column shows before the tail is folded into one.
 *
 * Eight is what the figure can label without the text colliding. The tail is
 * folded rather than dropped — "six Initiatives with one person each" is a
 * finding, and cutting it would hide exactly that.
 */
const MAX_ROWS = 8;
const OTHERS = '__others__';
const GAP_SHARE = 0.28;

interface Row {
  label: string;
  value: number;
}

function foldTail(rows: Map<string, Row>): Map<string, Row> {
  if (rows.size <= MAX_ROWS) return rows;
  const sorted = [...rows.entries()].sort((a, b) => b[1].value - a[1].value);
  const kept = sorted.slice(0, MAX_ROWS - 1);
  const tail = sorted.slice(MAX_ROWS - 1);
  const folded = new Map(kept);
  folded.set(OTHERS, {
    label: `${tail.length} more`,
    value: tail.reduce((sum, [, v]) => sum + v.value, 0),
  });
  return folded;
}

function layoutColumn(rows: Map<string, Row>, dimension: Dimension, column: number): FlowNode[] {
  const entries = [...rows.entries()];
  const total = entries.reduce((sum, [, v]) => sum + v.value, 0);
  if (total === 0) return [];
  const gaps = Math.max(0, entries.length - 1);
  const gap = gaps === 0 ? 0 : GAP_SHARE / gaps;
  const barShare = 1 - (gaps === 0 ? 0 : GAP_SHARE);

  let cursor = 0;
  return entries.map(([id, row]) => {
    const height = (row.value / total) * barShare;
    const node: FlowNode = {
      id: `${column}:${id}`,
      dimension,
      entityId: id,
      label: row.label,
      value: row.value,
      column,
      offset: cursor,
      height,
    };
    cursor += height + gap;
    return node;
  });
}

/** Each Element's buckets per column, with the weight it carries in each. */
interface Placement {
  /** One entry per column: the bucket ids this Element sits in. */
  perColumn: string[][];
  /** Weight in each column's buckets — 1 / bucket count for that column. */
  shares: number[];
}

export function effortFlow(
  elements: ElementWithDetails[],
  dimensions: Dimension[],
  ctx: DimensionContext = {},
): EffortFlow {
  const wanted = dimensions.filter((d, i) => dimensions.indexOf(d) === i).slice(0, 3);
  if (elements.length === 0 || wanted.length < 2) {
    return { nodes: [], links: [], columns: [], total: 0 };
  }

  // One pass: the buckets an Element lands in, and the label each carries.
  // Asking `bucketsOf` again for the labels would run the whole mapping twice
  // over every Element for every column.
  const labels = new Map<string, string>();
  const placements: Placement[] = elements.map((element) => {
    const perColumn = wanted.map((d, i) => {
      const buckets = bucketsOf(element, d, ctx);
      for (const b of buckets) labels.set(`${i}:${b.id}`, b.label);
      return buckets.map((b) => b.id);
    });
    return { perColumn, shares: perColumn.map((ids) => (ids.length === 0 ? 0 : 1 / ids.length)) };
  });

  const columnRows = wanted.map(() => new Map<string, Row>());
  placements.forEach((p) => {
    p.perColumn.forEach((ids, i) => {
      for (const id of ids) {
        const rows = columnRows[i];
        const key = id;
        const current = rows.get(key);
        const value = p.shares[i];
        if (current) current.value += value;
        else rows.set(key, { label: labels.get(`${i}:${id}`) ?? id, value });
      }
    });
  });

  // A column whose every Element lands in one bucket separates nothing. The
  // Initiative page is the case this exists for: one Initiative, one box, every
  // ribbon into it.
  const keep = wanted.map((_, i) => i === 0 || i === 1 || columnRows[i].size > 1);
  const columns = wanted.filter((_, i) => keep[i]);
  const keptIndexes = wanted.map((_, i) => i).filter((i) => keep[i]);

  const folded = keptIndexes.map((i) => foldTail(columnRows[i]));
  const nodes = keptIndexes.flatMap((i, c) => layoutColumn(folded[c], wanted[i], c));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keyOf = (c: number, id: string) => (folded[c].has(id) ? id : OTHERS);

  const edges = new Map<string, { from: string; to: string; value: number }>();
  const bump = (from: string, to: string, by: number) => {
    const key = `${from}->${to}`;
    const current = edges.get(key);
    if (current) current.value += by;
    else edges.set(key, { from, to, value: by });
  };

  for (const p of placements) {
    for (let c = 0; c + 1 < keptIndexes.length; c += 1) {
      const fromIds = p.perColumn[keptIndexes[c]];
      const toIds = p.perColumn[keptIndexes[c + 1]];
      if (fromIds.length === 0 || toIds.length === 0) continue;
      // The Element's single unit of weight, spread over every pair of
      // buckets it connects, so a ribbon set sums to one per Element.
      const share = 1 / (fromIds.length * toIds.length);
      for (const f of fromIds) {
        for (const t of toIds) {
          bump(`${c}:${keyOf(c, f)}`, `${c + 1}:${keyOf(c + 1, t)}`, share);
        }
      }
    }
  }

  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  for (const e of edges.values()) {
    outTotal.set(e.from, (outTotal.get(e.from) ?? 0) + e.value);
    inTotal.set(e.to, (inTotal.get(e.to) ?? 0) + e.value);
  }

  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const links: FlowLink[] = [];

  for (const [id, e] of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;

    // Scaled by the node's total flow on that side, not by its value: a node
    // whose ribbons carry more than its own weight would otherwise have its
    // last ribbon run past the bottom of the box.
    const fromTotal = outTotal.get(e.from) ?? 0;
    const toTotal = inTotal.get(e.to) ?? 0;
    const fromHeight = fromTotal === 0 ? 0 : (e.value / fromTotal) * from.height;
    const toHeight = toTotal === 0 ? 0 : (e.value / toTotal) * to.height;
    const fromOffset = from.offset + (outCursor.get(e.from) ?? 0);
    const toOffset = to.offset + (inCursor.get(e.to) ?? 0);
    outCursor.set(e.from, (outCursor.get(e.from) ?? 0) + fromHeight);
    inCursor.set(e.to, (inCursor.get(e.to) ?? 0) + toHeight);

    links.push({ id, from: e.from, to: e.to, value: e.value, fromOffset, fromHeight, toOffset, toHeight });
  }

  return { nodes, links, columns, total: elements.length };
}

/** The folded row stands for several things, so it is not a row to open. */
export function isFoldedNode(node: FlowNode): boolean {
  return node.entityId === OTHERS;
}

/** `Assignee → Object`, for the frame's header. */
export function flowTitle(columns: Dimension[]): string {
  return columns.map((d) => DIMENSION_LABEL[d]).join(' → ');
}
