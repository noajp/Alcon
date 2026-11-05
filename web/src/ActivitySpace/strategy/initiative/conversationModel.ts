// A Strategy conversation as the page shows it, read from the run's steps
// (the engine's transcript stays on the server). Pure. The person's turns
// are their messages; the agent's turns are what it said and, between, the
// work it did — folded into one line ("wrote 3 to the Strategy, read 2")
// that opens to the list, the way a coding agent shows its tool calls.

export type WorkKind = 'write' | 'read' | 'web' | 'plan';

export interface WorkItem {
  id: string;
  /** The tool, for the label ("addIntent"); a web step's own line otherwise. */
  name: string;
  kind: WorkKind;
  /** What it was about (a title, a name, a query), or the Planner's guidance. */
  detail: string;
  ok: boolean;
  error?: string;
}

export type AgentSegment = { kind: 'text'; text: string } | { kind: 'work'; items: WorkItem[] };

export type ConversationItem =
  | { kind: 'person'; text: string }
  | { kind: 'agent'; segments: AgentSegment[] };

export interface ConversationStep { id: string; type: string; title: string; detail: string | null }

const WRITES = new Set(['updateInitiative', 'createInitiative', 'addIntent', 'updateIntent', 'removeIntent', 'writeInitiativeDefinition']);
const ALCON = 'Alcon: ';

function work(step: ConversationStep): WorkItem | null {
  if (step.type === 'plan_request') return { id: step.id, name: 'hand_to_planner', kind: 'plan', detail: step.detail ?? '', ok: true };
  const failed = step.type === 'error';
  if (step.title.startsWith(ALCON)) {
    const name = step.title.slice(ALCON.length);
    return {
      id: step.id, name, kind: WRITES.has(name) ? 'write' : 'read', ok: !failed,
      detail: failed ? '' : step.detail ?? '', ...(failed ? { error: step.detail ?? '' } : {}),
    };
  }
  // The engine's lines for the web: "Web 検索: …", "ページを読む: …".
  if (step.type === 'action') return { id: step.id, name: step.title, kind: 'web', detail: '', ok: true };
  return null;
}

/** Pure. The run's steps, in order, as conversation items. */
export function conversationItems(steps: ConversationStep[]): ConversationItem[] {
  const items: ConversationItem[] = [];
  const agent = (): AgentSegment[] => {
    const last = items[items.length - 1];
    if (last?.kind === 'agent') return last.segments;
    const segments: AgentSegment[] = [];
    items.push({ kind: 'agent', segments });
    return segments;
  };
  for (const step of steps) {
    if (step.type === 'message') {
      const text = (step.detail ?? step.title).trim();
      if (text) items.push({ kind: 'person', text });
      continue;
    }
    if (step.type === 'reply') {
      const text = (step.detail ?? step.title).trim();
      if (text) agent().push({ kind: 'text', text });
      continue;
    }
    const w = work(step);
    if (!w) continue;
    const segments = agent();
    const last = segments[segments.length - 1];
    if (last?.kind === 'work') last.items.push(w);
    else segments.push({ kind: 'work', items: [w] });
  }
  return items;
}

/** Pure. How many of each kind a folded work line stands for. */
export function workTally(items: WorkItem[]): Record<WorkKind, number> & { failed: number } {
  const tally = { write: 0, read: 0, web: 0, plan: 0, failed: 0 };
  for (const w of items) {
    tally[w.kind] += 1;
    if (!w.ok) tally.failed += 1;
  }
  return tally;
}
