// =============================================================
// Where the people actually are — Worker → Object → Campaign.
//
// PRODUCT.md calls the Execution layer "Employment of Means: 誰／何を、どの
// 仕事に投入して成果を作るか". Every surface answers the second half — this
// Object has these Elements, that Campaign has those Objects — and none of
// them answers the first. A roster says who exists. A workload says how full
// somebody is. Neither says *where the effort went*, and that is the question
// a portfolio decision is made on: the Campaign everyone calls critical can be
// carrying two people while the one nobody mentions carries nine.
//
// A flow answers it because it is the only shape that keeps both ends of the
// sentence in one picture. A stacked bar per Campaign loses who; a bar per
// Worker loses what for.
//
// The unit is one assigned Element, not hours. Estimates are set on some
// Elements and not others, and a bar that silently mixes "3 hours" with "1
// unestimated task" is the invented comparison `campaignMeasureModel` refuses
// to make elsewhere. Counting assignments is a claim every row can support.
//
// Pure on purpose: no React, no Supabase, no clock.
// =============================================================

export type FlowKind = 'worker' | 'object' | 'campaign';

/** One assignment, flattened: this person is on this Element in this Object. */
export interface AssignmentInput {
  elementId: string;
  workerId: string;
  workerName: string;
  objectId: string;
  objectName: string;
}

export interface FlowNode {
  id: string;
  kind: FlowKind;
  /** The row's own id, for opening it. Same as `id` minus the kind prefix. */
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
  /** 0–1 offsets of the ribbon's edge where it leaves / meets each node. */
  fromOffset: number;
  fromHeight: number;
  toOffset: number;
  toHeight: number;
}

export interface EffortFlow {
  nodes: FlowNode[];
  links: FlowLink[];
  columns: FlowKind[];
  /** Assignments counted, before any node was folded into "Others". */
  total: number;
}

/**
 * How many nodes a column shows before the tail is folded into one row.
 *
 * Eight is what a 320-pixel-tall figure can label without the text colliding.
 * The tail is kept rather than dropped — a Campaign carrying one person each
 * across six Campaigns is a finding, and cutting them would hide it.
 */
const MAX_ROWS = 8;
const OTHERS = '…others';

/** Vertical share of a column given to the gaps between its nodes. */
const GAP_SHARE = 0.28;

function foldTail(
  counts: Map<string, { label: string; value: number }>,
): Map<string, { label: string; value: number }> {
  if (counts.size <= MAX_ROWS) return counts;
  const sorted = [...counts.entries()].sort((a, b) => b[1].value - a[1].value);
  const kept = sorted.slice(0, MAX_ROWS - 1);
  const tail = sorted.slice(MAX_ROWS - 1);
  const folded = new Map(kept);
  folded.set(OTHERS, {
    label: `${tail.length} more`,
    value: tail.reduce((sum, [, v]) => sum + v.value, 0),
  });
  return folded;
}

/** Lay a column out top-to-bottom, heights proportional to value. */
function layoutColumn(
  entries: [string, { label: string; value: number }][],
  kind: FlowKind,
  column: number,
): FlowNode[] {
  const total = entries.reduce((sum, [, v]) => sum + v.value, 0);
  if (total === 0) return [];
  const gaps = Math.max(0, entries.length - 1);
  const gap = gaps === 0 ? 0 : GAP_SHARE / gaps;
  const barShare = 1 - (gaps === 0 ? 0 : GAP_SHARE);

  let cursor = 0;
  return entries.map(([id, v]) => {
    const height = (v.value / total) * barShare;
    const node: FlowNode = {
      id: `${kind}:${id}`,
      kind,
      entityId: id,
      label: v.label,
      value: v.value,
      column,
      offset: cursor,
      height,
    };
    cursor += height + gap;
    return node;
  });
}

/**
 * Build the flow.
 *
 * `campaignsByObject` maps an Object to the Campaigns it feeds. An Object in
 * two Campaigns splits its outflow evenly between them: the assignment is one
 * piece of work and counting it once per Campaign would inflate the total past
 * the number of assignments that exist. Node values stay whole because they
 * are counted from assignments, not from the split.
 */
export function effortFlow(
  assignments: AssignmentInput[],
  campaignsByObject: Map<string, { id: string; name: string }[]>,
): EffortFlow {
  if (assignments.length === 0) {
    return { nodes: [], links: [], columns: [], total: 0 };
  }

  const workers = new Map<string, { label: string; value: number }>();
  const objects = new Map<string, { label: string; value: number }>();
  const campaigns = new Map<string, { label: string; value: number }>();

  for (const a of assignments) {
    workers.set(a.workerId, {
      label: a.workerName,
      value: (workers.get(a.workerId)?.value ?? 0) + 1,
    });
    objects.set(a.objectId, {
      label: a.objectName,
      value: (objects.get(a.objectId)?.value ?? 0) + 1,
    });
    for (const c of campaignsByObject.get(a.objectId) ?? []) {
      campaigns.set(c.id, { label: c.name, value: (campaigns.get(c.id)?.value ?? 0) + 1 });
    }
  }

  // The third column earns its place only when it separates anything. One
  // Campaign — the Campaign page's own case — would draw every ribbon into a
  // single box and say nothing.
  const showCampaigns = campaigns.size > 1;
  const columns: FlowKind[] = showCampaigns
    ? ['worker', 'object', 'campaign']
    : ['worker', 'object'];

  const workerRows = foldTail(workers);
  const objectRows = foldTail(objects);
  const campaignRows = showCampaigns ? foldTail(campaigns) : new Map();

  const keyOf = (rows: Map<string, unknown>, id: string) => (rows.has(id) ? id : OTHERS);

  const workerNodes = layoutColumn([...workerRows.entries()], 'worker', 0);
  const objectNodes = layoutColumn([...objectRows.entries()], 'object', 1);
  const campaignNodes = showCampaigns
    ? layoutColumn([...campaignRows.entries()], 'campaign', 2)
    : [];
  const nodes = [...workerNodes, ...objectNodes, ...campaignNodes];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Ribbon weights. The pair is carried as fields rather than encoded into
  // the key and parsed back out — a separator inside an id is the kind of bug
  // that shows up as a missing ribbon and nothing else.
  const edges = new Map<string, { from: string; to: string; value: number }>();
  const bump = (from: string, to: string, by: number) => {
    const key = `${from}->${to}`;
    const current = edges.get(key);
    if (current) current.value += by;
    else edges.set(key, { from, to, value: by });
  };

  for (const a of assignments) {
    const w = `worker:${keyOf(workerRows, a.workerId)}`;
    const o = `object:${keyOf(objectRows, a.objectId)}`;
    bump(w, o, 1);

    if (!showCampaigns) continue;
    const owning = campaignsByObject.get(a.objectId) ?? [];
    if (owning.length === 0) continue;
    const share = 1 / owning.length;
    for (const c of owning) bump(o, `campaign:${keyOf(campaignRows, c.id)}`, share);
  }

  // A node's outflow can exceed its own count when it feeds two Campaigns at
  // half weight each, so ribbons are scaled by the node's total flow on that
  // side rather than by its value — otherwise the last one runs past the box.
  const outTotal = new Map<string, number>();
  const inTotal = new Map<string, number>();
  for (const e of edges.values()) {
    outTotal.set(e.from, (outTotal.get(e.from) ?? 0) + e.value);
    inTotal.set(e.to, (inTotal.get(e.to) ?? 0) + e.value);
  }

  // Ribbons stack against the edge of each node in the order they were built,
  // so a node's widths sum to its own height and nothing overlaps.
  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const links: FlowLink[] = [];

  for (const [id, e] of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;

    const fromTotal = outTotal.get(e.from) ?? 0;
    const toTotal = inTotal.get(e.to) ?? 0;
    const fromHeight = fromTotal === 0 ? 0 : (e.value / fromTotal) * from.height;
    const toHeight = toTotal === 0 ? 0 : (e.value / toTotal) * to.height;
    const fromOffset = from.offset + (outCursor.get(e.from) ?? 0);
    const toOffset = to.offset + (inCursor.get(e.to) ?? 0);
    outCursor.set(e.from, (outCursor.get(e.from) ?? 0) + fromHeight);
    inCursor.set(e.to, (inCursor.get(e.to) ?? 0) + toHeight);

    links.push({
      id,
      from: e.from,
      to: e.to,
      value: e.value,
      fromOffset,
      fromHeight,
      toOffset,
      toHeight,
    });
  }

  return { nodes, links, columns, total: assignments.length };
}

/** The folded row is not a row anyone can open. */
export function isFoldedNode(node: FlowNode): boolean {
  return node.entityId === OTHERS;
}
