import type { ParsedDefinition } from '@/AIP/harness/harnessDefinition';

// The canvas's reading of a definition (Sim-incorporation prototype,
// P3): a pure projection from the definition's own structure — the
// Procedure section's steps in order, Checks as a gate before the
// end, the Stop conditions as the terminal node, the Output's shape
// as the artifact — plus the row the definition runs under (its
// trigger, and the Object its runs ticket Elements into). The body
// text stays the single truth: the projection holds no state of its
// own, positions are derived from order alone and never written
// back, and the same body always projects to the same graph.
//
// What the graph draws is the intent the author declared in the
// text. A conditional step is a sentence in the Procedure ("〜の場
// 合"), not a compiled branch: execution is model-driven, so the
// canvas shows the declared intent, dashed, and its legend says so.

/** How the work starts, as the row it runs under declares it. */
export type FlowTrigger =
  | { kind: 'schedule'; cron: string; timezone: string | null }
  | { kind: 'webhook' }
  | { kind: 'manual' };

/** The row the definition runs under — the part of the picture the
 *  body text does not carry. */
export interface FlowContext {
  trigger: FlowTrigger | null;
  /** The Object the run tickets its Element into, by name. */
  objectName: string | null;
}

export type FlowNodeKind =
  | 'trigger' | 'target' | 'step' | 'condition' | 'checks' | 'output' | 'stop';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  /** The card's one line: the step's first line, the cron the
   *  trigger keeps, the first check — the text itself, never a
   *  paraphrase. Empty only where the row gives the node no text of
   *  its own (a webhook or manual trigger): the card then speaks
   *  with its kind label alone. */
  title: string;
  /** The rest of the text the first line opened, when there is more. */
  detail: string | null;
  /** A display fact beside the title: the output's format. */
  badge: string | null;
  /** For a trigger node, which trigger it is, so the card can phrase
   *  the ones that carry no text of their own. */
  triggerKind: FlowTrigger['kind'] | null;
  position: { x: number; y: number };
  /** 0: the main chain. 1: a condition branched off its parent. */
  column: 0 | 1;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  kind: 'sequence' | 'branch';
}

export interface FlowProjection {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** The connectors the definition names — chips, not steps. */
  connectors: string[];
  /** How the work's assignee is decided, as the Assignment section's
   *  first line states it — an annotation beside the steps, not a
   *  node in the chain. */
  assignment: string | null;
  /** True when neither the body nor the row gave anything to draw. */
  empty: boolean;
}

/** Node geometry: one width for every card, one row pitch, one
 *  branch column. Constants, not state — the layout is a function of
 *  order alone. */
export const FLOW_NODE_WIDTH = 264;
export const FLOW_ROW_HEIGHT = 118;
export const FLOW_COLUMN_X = 312;

const BULLET = /^\s*(?:[-*・]|\d+[.)])\s+(.+)$/;

interface TextBlock { title: string; rest: string[] }

/**
 * A section read the way the definition's own readers read text: a
 * bullet line opens a block and the lines that follow belong to it,
 * so a block's first line is its summary (Sim's canvasPresentation
 * pattern, derived from the definition's own words). A section with
 * no bullets at all reads one block per line — the honest
 * degradation for a body that did not use bullets.
 */
function readBlocks(section: string): TextBlock[] {
  const lines = section.split('\n');
  if (!lines.some((l) => BULLET.test(l))) {
    return lines.map((l) => l.trim()).filter(Boolean).map((title) => ({ title, rest: [] }));
  }
  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;
  for (const raw of lines) {
    const b = BULLET.exec(raw);
    if (b) {
      current = { title: b[1].trim(), rest: [] };
      blocks.push(current);
      continue;
    }
    const text = raw.trim();
    if (!text) continue;
    if (current) current.rest.push(text);
    else {
      current = { title: text, rest: [] };
      blocks.push(current);
    }
  }
  return blocks;
}

/** Everything a block holds after its first line, as one text. */
function restOf(blocks: TextBlock[], first: TextBlock): string | null {
  const lines = [
    ...first.rest,
    ...blocks.slice(blocks.indexOf(first) + 1).flatMap((b) => [b.title, ...b.rest]),
  ];
  return lines.length ? lines.join('\n') : null;
}

/** Pure. A Procedure line written as a condition — the declared
 *  intent to branch, in the text's own conditional vocabulary:
 *  場合 (〜の場合・〜がある場合) and なら, wherever they appear in
 *  the line. Read literally, as the design names them. */
function isConditional(title: string): boolean {
  return /場合|なら/.test(title);
}

/**
 * Pure. The definition, drawn: the row's trigger and target first,
 * then the Procedure's steps in order (a conditional step branches
 * off the step before it), then the Checks gate, the Output, and the
 * Stop conditions as the terminal node — each present only when the
 * text declares it. Connectors and the Assignment rule ride along as
 * annotations, never as steps.
 */
export function projectDefinitionFlow(def: ParsedDefinition, context: FlowContext): FlowProjection {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const chain: string[] = [];
  const rowOf = new Map<string, number>();
  let row = 0;
  let branchRow = 0;

  const place = (node: FlowNode, column: 0 | 1, atRow: number) => {
    node.column = column;
    node.position = { x: column === 0 ? 0 : FLOW_COLUMN_X, y: atRow * FLOW_ROW_HEIGHT };
    nodes.push(node);
  };
  const mainNode = (node: FlowNode) => {
    place(node, 0, row);
    rowOf.set(node.id, row);
    chain.push(node.id);
    row += 1;
  };
  const bare = (id: string, kind: FlowNodeKind): FlowNode => ({
    id, kind, title: '', detail: null, badge: null, triggerKind: null,
    position: { x: 0, y: 0 }, column: 0,
  });

  // The row the definition runs under: how it starts, where its work lands.
  if (context.trigger) {
    const node = bare('trigger', 'trigger');
    node.triggerKind = context.trigger.kind;
    if (context.trigger.kind === 'schedule') {
      node.title = context.trigger.cron;
      node.badge = context.trigger.timezone;
    }
    mainNode(node);
  }
  if (context.objectName) {
    const node = bare('target', 'target');
    node.title = context.objectName;
    mainNode(node);
  }

  // The Procedure's steps, in the order the text gives them. A
  // conditional step hangs off the step before it (or off the target
  // or trigger when it opens the list; with nothing before it at
  // all, it takes a place in the chain itself, drawn as a condition).
  let lastMainId: string | null = chain[chain.length - 1] ?? null;
  readBlocks(def.sections.procedure).forEach((block, i) => {
    const conditional = isConditional(block.title);
    const node = bare(`step-${i}`, conditional ? 'condition' : 'step');
    node.title = block.title;
    node.detail = block.rest.length ? block.rest.join('\n') : null;
    if (conditional && lastMainId) {
      branchRow = Math.max(branchRow, rowOf.get(lastMainId) ?? 0);
      place(node, 1, branchRow);
      branchRow += 1;
      edges.push({ id: `edge-${node.id}`, source: lastMainId, target: node.id, kind: 'branch' });
    } else {
      mainNode(node);
      lastMainId = node.id;
    }
  });

  // The Checks gate, just before the end: the list a reviewer holds
  // the work to. Read from the parser's own items where it has them.
  const checkBlocks = def.checks.items.length
    ? def.checks.items.map((title) => ({ title, rest: [] as string[] }))
    : readBlocks(def.sections.checks);
  if (checkBlocks.length) {
    const node = bare('checks', 'checks');
    node.title = checkBlocks[0].title;
    node.detail = restOf(checkBlocks, checkBlocks[0]);
    mainNode(node);
  }

  // The Output's shape: the artifact the work must produce.
  if (def.output) {
    const node = bare('output', 'output');
    const firstLine = def.output.body.split('\n').map((l) => l.trim()).find(Boolean);
    node.title = firstLine ?? def.output.format;
    node.badge = def.output.format;
    mainNode(node);
  }

  // The Stop conditions close the chain: where the work ends, or
  // hands itself back to a person.
  const stopBlocks = readBlocks(def.sections.stop);
  if (stopBlocks.length) {
    const node = bare('stop', 'stop');
    node.title = stopBlocks[0].title;
    node.detail = restOf(stopBlocks, stopBlocks[0]);
    mainNode(node);
  }

  for (let i = 0; i + 1 < chain.length; i += 1) {
    edges.push({ id: `edge-${chain[i]}-${chain[i + 1]}`, source: chain[i], target: chain[i + 1], kind: 'sequence' });
  }

  const assignmentBlocks = readBlocks(def.sections.assignment);
  return {
    nodes,
    edges,
    connectors: def.connectors,
    assignment: assignmentBlocks[0]?.title ?? null,
    empty: nodes.length === 0,
  };
}
