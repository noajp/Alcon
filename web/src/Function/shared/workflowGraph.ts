import { flowStepTitles } from '@/Function/shared/flowEdit';

// An automation's workflow as it is drawn: steps and decisions placed on a
// canvas and joined by arrows from its start. The drawing is kept as it is
// (automations.workflow_graph), and the text the run reads
// (automations.workflow, a "# 進め方" list) is written from it, so the two
// never disagree: every edit on the canvas rewrites the text.

export type WorkflowNodeKind = 'step' | 'condition';

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  x: number;
  y: number;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** On an arrow out of a decision: when it is taken ("はい", "在庫なし"). */
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** The start of every workflow — the automation's trigger. Not stored as a
 *  node; arrows may leave it. */
export const WORKFLOW_START = 'start';
/** The canvas runs left to right: one column per step, branches stacked. */
export const WORKFLOW_COLUMN = 300;
export const WORKFLOW_ROW = 150;

/** Pure. A stored drawing, or null when it is not one. Unknown fields are
 *  dropped; arrows to nodes that are gone are dropped too. */
export function parseWorkflowGraph(value: unknown): WorkflowGraph | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;
  const nodes: WorkflowNode[] = [];
  for (const n of v.nodes as Record<string, unknown>[]) {
    if (!n || typeof n.id !== 'string' || n.id === WORKFLOW_START) continue;
    nodes.push({
      id: n.id,
      kind: n.kind === 'condition' ? 'condition' : 'step',
      label: typeof n.label === 'string' ? n.label : '',
      x: Number.isFinite(n.x) ? Number(n.x) : 0,
      y: Number.isFinite(n.y) ? Number(n.y) : 0,
    });
  }
  const ids = new Set([WORKFLOW_START, ...nodes.map((n) => n.id)]);
  const edges: WorkflowEdge[] = [];
  for (const e of v.edges as Record<string, unknown>[]) {
    if (!e || typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') continue;
    if (!ids.has(e.source) || !ids.has(e.target) || e.target === WORKFLOW_START) continue;
    edges.push({ id: e.id, source: e.source, target: e.target, ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}) });
  }
  return { nodes, edges };
}

/** Pure. A written workflow drawn as a straight line of steps from the
 *  start — how a workflow picked from text (a harness's procedure) lands
 *  on the canvas. */
export function graphFromWorkflow(text: string): WorkflowGraph {
  const titles = flowStepTitles(text);
  const nodes = titles.map((label, i): WorkflowNode => ({ id: `n${i + 1}`, kind: 'step', label, x: WORKFLOW_COLUMN * (i + 1), y: 0 }));
  const edges = nodes.map((n, i): WorkflowEdge => ({ id: `e${i + 1}`, source: i === 0 ? WORKFLOW_START : nodes[i - 1].id, target: n.id }));
  return { nodes, edges };
}

/** Pure. The order the steps are numbered in: along the arrows from the
 *  start (a node's next steps top to bottom), then whatever is not
 *  reached, left to right. */
function workflowOrder(g: WorkflowGraph): WorkflowNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const branch = (a: WorkflowNode, b: WorkflowNode) => a.y - b.y || a.x - b.x;
  const along = (a: WorkflowNode, b: WorkflowNode) => a.x - b.x || a.y - b.y;
  const out: WorkflowNode[] = [];
  const seen = new Set<string>();
  const queue = [WORKFLOW_START];
  while (queue.length) {
    const id = queue.shift()!;
    const next = g.edges.filter((e) => e.source === id).map((e) => byId.get(e.target)).filter((n): n is WorkflowNode => !!n).sort(branch);
    for (const n of next) {
      if (seen.has(n.id)) continue;
      seen.add(n.id); out.push(n); queue.push(n.id);
    }
  }
  return [...out, ...g.nodes.filter((n) => !seen.has(n.id)).sort(along)];
}

/** Pure. The text the run reads: one numbered line per step, a decision
 *  marked as one, and under a line where its arrows go when that is not
 *  simply the next number. Empty for an empty drawing. */
export function workflowFromGraph(g: WorkflowGraph): string {
  const order = workflowOrder(g).filter((n) => n.label.trim());
  if (order.length === 0) return '';
  const number = new Map(order.map((n, i) => [n.id, i + 1]));
  const lines = ['# 進め方'];
  order.forEach((n, i) => {
    const label = n.label.trim().replace(/\s*\n\s*/g, ' ');
    lines.push(`${i + 1}. ${n.kind === 'condition' ? `判断: ${label}` : label}`);
    const out = g.edges.filter((e) => e.source === n.id && number.has(e.target));
    const plain = out.length === 1 && !out[0].label && number.get(out[0].target) === i + 2;
    if (plain) return;
    if (out.length === 0) {
      if (i < order.length - 1) lines.push('   → ここで終わる');
      return;
    }
    for (const e of out) {
      lines.push(`   → ${e.label ? `「${e.label}」なら ` : ''}${number.get(e.target)} へ`);
    }
  });
  return `${lines.join('\n')}\n`;
}
