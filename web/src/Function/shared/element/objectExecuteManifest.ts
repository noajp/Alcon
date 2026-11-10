import { computeBlockers, type DependencyBlocker, type DependencyEdgeRow } from './dependencyReadiness';

// The Object Execute popup's reading (card hover-execute, PR2): what
// would start, what would not, and why — a manifest, not a plan. An
// Object has no plan unit in the machinery and this model invents none;
// it only reads what the board already reads (Element statuses, the
// runs, the depends_on edges, the chain's waiting reasons, who carries
// each Element) and gives every Element one disposition, in the
// precedence of the design's §6.1. Pure: the dialog acts on what this
// model says (the startable set, in order), and nothing here starts
// anything.

/** The Element shape the manifest needs; the board's MissionElementRow
 *  satisfies it. */
export interface ManifestElementRow {
  id: string;
  title: string;
  display_id?: string | null;
  status?: string | null;
  /** Who carries it out: an AI Worker, a person, or nobody yet. */
  assignee?: 'ai' | 'human' | null;
  assigneeName?: string | null;
}

/** The run shape the manifest needs — any run row of these Elements;
 *  the model picks each Element's open run, when it has one. */
export interface ManifestRunRow {
  element_id: string;
  status: string;
  created_at?: string | null;
}

/** The edge shape the manifest needs. The board's edge fetch already
 *  filters to `depends_on` server-side, so an edge that names no type
 *  reads as `depends_on`; an edge that names another type is ignored,
 *  exactly as `computeBlockers` ignores it. */
export interface ManifestEdgeRow {
  from_element: string;
  to_element: string;
  edge_type?: string | null;
}

/** The chain's waiting reading for one Element (waiting.ts's
 *  WaitingReason, structurally): why it waits on a person. The hosts
 *  compute it with the same function the cards' chips read, so the
 *  manifest and the chips can never disagree. */
export interface ManifestWaiting {
  kind: 'approval' | 'answer' | 'readings' | 'review' | 'verb' | 'blocked' | 'paused' | 'dependency';
  /** A person's act is what unblocks this. */
  needsPerson: boolean;
  /** For 'readings': how many proposals are held. */
  heldReadings?: number;
}

/** One Element's disposition — the first match in §6.1's precedence. */
export type ManifestDisposition =
  | { kind: 'done' }
  | { kind: 'cancelled' }
  /** An open run exists; `runStatus` carries its resting word (an
   *  approval / an answer it waits for, a pause). */
  | { kind: 'running'; runStatus: string }
  /** Unresolved depends_on upstreams, in edge order; the row names the
   *  first and counts the rest. */
  | { kind: 'blocked'; blockers: DependencyBlocker[] }
  /** Waiting on a person, by the chain's own reading. */
  | { kind: 'waiting'; waiting: ManifestWaiting }
  /** A person's task (design D4): Object execute never pulls it into
   *  an AI run. `name` is the person's, when the board knows it. */
  | { kind: 'with-person'; name: string | null }
  | { kind: 'will-start' };

export interface ManifestRow {
  element: ManifestElementRow;
  disposition: ManifestDisposition;
  /** True only for 'will-start': Execute starts exactly these. */
  starts: boolean;
}

export interface ObjectExecuteManifest {
  /** Every row, ordered: the startable first (dependency order), then
   *  running, blocked, waiting, with a person, done, cancelled — each
   *  later group in the Object's own Element order. */
  rows: ManifestRow[];
  /** The rows Execute starts, in the order it starts them. */
  startable: ManifestRow[];
  toStart: number;
  skipped: number;
}

export interface ObjectManifestInput {
  /** The Object's own Elements, in the Object's order. */
  elements: readonly ManifestElementRow[];
  /** Extra Element rows a blocker lookup may need (upstreams that sit
   *  in other Objects); defaults to the Object's own Elements. A hidden
   *  upstream holds nothing back — computeBlockers' standing rule. */
  upstreams?: readonly ManifestElementRow[];
  edges: readonly ManifestEdgeRow[];
  runs: readonly ManifestRunRow[];
  /** Each Element's waiting-on-a-person reading, keyed by Element id —
   *  the map the cards' chips read (waitingReasonsByElement / the
   *  Domain chain's per-card map). */
  waiting?: ReadonlyMap<string, ManifestWaiting | null>;
}

/** A run that is still its Element's run. agentData's open statuses,
 *  plus 'awaiting_input': a run resting on a question is already going
 *  (its starter's to resume), and §6.1 names the answer as disposition
 *  3's resting word — it is not a startable Element. 'awaiting_review'
 *  is deliberately not here: that run's work is finished, and the
 *  Element waits on a person's review — disposition 5's reading. */
const OPEN_RUN_STATUSES: readonly string[] = ['queued', 'running', 'awaiting_approval', 'awaiting_input', 'paused'];

/** Display order of the skipped groups, after the startable (§6.1:
 *  then 3, 4, 5, 6, 1, 2). */
const GROUP_ORDER: Record<ManifestDisposition['kind'], number> = {
  'will-start': 0, running: 1, blocked: 2, waiting: 3, 'with-person': 4, done: 5, cancelled: 6,
};

/** Pure. A set of Elements in dependency order over the internal
 *  depends_on edges among them (upstreams before downstreams), the
 *  given order kept wherever the edges say nothing. For the startable
 *  set this order is presentational by construction — a startable
 *  Element's upstreams are all done, so no internal edge survives the
 *  blocker rule between two of them — and honest: were the blocker
 *  rule ever to loosen, a start would still never jump ahead of an
 *  Element it names as its predecessor. A cycle, which the dependency
 *  writer refuses, falls back to the given order. Exported for its
 *  tests, on the isExecuteEdgeZone precedent. */
export function startableDependencyOrder(
  startable: readonly ManifestElementRow[],
  edges: readonly DependencyEdgeRow[],
): ManifestElementRow[] {
  const ids = new Set(startable.map((e) => e.id));
  const pending = new Map<string, Set<string>>();
  for (const e of startable) pending.set(e.id, new Set());
  for (const edge of edges) {
    if (edge.edge_type !== 'depends_on') continue;
    if (!ids.has(edge.from_element) || !ids.has(edge.to_element)) continue;
    if (edge.from_element === edge.to_element) continue;
    pending.get(edge.to_element)!.add(edge.from_element);
  }
  const out: ManifestElementRow[] = [];
  const emitted = new Set<string>();
  const rest = [...startable];
  while (rest.length > 0) {
    const idx = rest.findIndex((e) => [...pending.get(e.id)!].every((u) => emitted.has(u)));
    if (idx === -1) { out.push(...rest); break; }
    const [next] = rest.splice(idx, 1);
    emitted.add(next.id);
    out.push(next);
  }
  return out;
}

/**
 * Pure. The Object's execute manifest: each Element's disposition by
 * §6.1's precedence — done, cancelled, an open run, unresolved
 * upstreams, waiting on a person, a person's own task (skipped, D4) —
 * and otherwise 'will-start', the only rows Execute starts. Elements
 * skipped as waiting are NOT chained: nothing here promises they start
 * when their blockers finish (§6.3).
 */
export function objectExecuteManifest(input: ObjectManifestInput): ObjectExecuteManifest {
  const { elements, edges, runs } = input;
  const ids = elements.map((e) => e.id);

  const upstreamRows = new Map<string, ManifestElementRow>();
  for (const e of [...elements, ...(input.upstreams ?? [])]) {
    if (!upstreamRows.has(e.id)) upstreamRows.set(e.id, e);
  }
  const depEdges: DependencyEdgeRow[] = edges.map((e) => ({
    from_element: e.from_element, to_element: e.to_element,
    edge_type: e.edge_type ?? 'depends_on',
  }));
  const blockersBy = computeBlockers(ids, depEdges, [...upstreamRows.values()]);

  const openRunBy = new Map<string, ManifestRunRow>();
  for (const run of runs) {
    if (!OPEN_RUN_STATUSES.includes(run.status)) continue;
    const seen = openRunBy.get(run.element_id);
    if (!seen || (run.created_at ?? '') > (seen.created_at ?? '')) openRunBy.set(run.element_id, run);
  }

  const dispositionOf = (element: ManifestElementRow): ManifestDisposition => {
    if (element.status === 'done') return { kind: 'done' };
    if (element.status === 'cancelled') return { kind: 'cancelled' };
    const open = openRunBy.get(element.id);
    if (open) return { kind: 'running', runStatus: open.status };
    const blockers = blockersBy[element.id] ?? [];
    if (blockers.length > 0) return { kind: 'blocked', blockers };
    const waiting = input.waiting?.get(element.id) ?? null;
    if (waiting && waiting.needsPerson && waiting.kind !== 'dependency') return { kind: 'waiting', waiting };
    if (element.assignee === 'human') return { kind: 'with-person', name: element.assigneeName ?? null };
    return { kind: 'will-start' };
  };

  const dispositions = new Map(elements.map((e) => [e.id, dispositionOf(e)] as const));
  const startableRows = startableDependencyOrder(
    elements.filter((e) => dispositions.get(e.id)!.kind === 'will-start'),
    depEdges,
  ).map((element): ManifestRow => ({ element, disposition: dispositions.get(element.id)!, starts: true }));

  const rest = elements
    .map((element, index) => ({ element, index, disposition: dispositions.get(element.id)! }))
    .filter((r) => r.disposition.kind !== 'will-start')
    .sort((a, b) => GROUP_ORDER[a.disposition.kind] - GROUP_ORDER[b.disposition.kind] || a.index - b.index)
    .map(({ element, disposition }): ManifestRow => ({ element, disposition, starts: false }));

  const rows = [...startableRows, ...rest];
  return { rows, startable: startableRows, toStart: startableRows.length, skipped: rest.length };
}
