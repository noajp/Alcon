// A Strategy conversation as the page shows it, read from the run's steps
// (the engine's transcript stays on the server). Pure. The person's turns
// are their messages; the agent's turns are what it said and, between, the
// work it did — folded into one line ("wrote 3 to the Strategy, read 2")
// that opens to the list, the way a coding agent shows its tool calls.

import type { TraceStep } from '@/Function/shared/workTrace';

export type WorkKind = 'write' | 'read' | 'web' | 'plan' | 'start' | 'answer' | 'connect';

/** A proposal the conversation made and the person decides on: the step's
 *  detail, parsed. Titles are the engine's snapshots, so the card reads
 *  even if the work has changed since. */
export type WorkProposal =
  | { kind: 'start'; elementIds: string[]; titles: string[] }
  | { kind: 'answer'; runId: string; elementId: string; elementTitle: string; text: string; question: string | null }
  | { kind: 'connect'; names: string[]; waitingFor: string };

/** What a work item is called in the conversation (i18n source strings). */
const WORK_LABEL: Record<string, string> = {
  updateInitiative: 'Updated the purpose',
  createInitiative: 'Added a Sub Strategy',
  addIntent: 'Recorded',
  updateIntent: 'Revised',
  removeIntent: 'Removed',
  writeInitiativeDefinition: 'Wrote the harness',
  getInitiative: 'Read the Strategy',
  listInitiatives: 'Listed Strategies',
  hand_to_planner: 'Handed to the Planner',
  web_search: 'Searched the web',
  web_fetch: 'Read a page',
  getInitiativeExecution: 'Read the work',
  propose_run_start: 'Proposed starting runs',
  propose_answer: 'Proposed an answer',
  propose_connection: 'Proposed a connection',
};

export interface WorkItem {
  id: string;
  /** The tool, for the label ("addIntent"); a web step's own line otherwise. */
  name: string;
  kind: WorkKind;
  /** What it was about (a title, a name, a query), or the Planner's guidance. */
  detail: string;
  ok: boolean;
  error?: string;
  /** The proposal a 'start' / 'answer' item carries; null when its step's
   *  detail could not be read — the item then stands as a plain work row. */
  proposal?: WorkProposal | null;
}

export type AgentSegment = { kind: 'text'; text: string } | { kind: 'work'; items: WorkItem[] };

export type ConversationItem =
  | { kind: 'person'; text: string }
  | { kind: 'agent'; segments: AgentSegment[] };

export interface ConversationStep { id: string; type: string; title: string; detail: string | null }

const WRITES = new Set(['updateInitiative', 'createInitiative', 'addIntent', 'updateIntent', 'removeIntent', 'writeInitiativeDefinition']);
const ALCON = 'Alcon: ';

/** Pure. A proposal step's detail, read defensively: anything unreadable
 *  or incomplete reads as no proposal, never as an exception. */
function proposalOf(step: ConversationStep): WorkProposal | null {
  if (step.type !== 'start_request' && step.type !== 'answer_request' && step.type !== 'connection_request') return null;
  try {
    const raw = JSON.parse(step.detail ?? '') as Record<string, unknown>;
    if (step.type === 'connection_request') {
      const names = Array.isArray(raw.names) ? raw.names.filter((v): v is string => typeof v === 'string' && !!v) : [];
      return names.length ? { kind: 'connect', names, waitingFor: typeof raw.waitingFor === 'string' ? raw.waitingFor : '' } : null;
    }
    if (step.type === 'start_request') {
      const elementIds = Array.isArray(raw.elementIds) ? raw.elementIds.filter((v): v is string => typeof v === 'string') : [];
      const titles = Array.isArray(raw.titles) ? raw.titles.filter((v): v is string => typeof v === 'string') : [];
      return elementIds.length ? { kind: 'start', elementIds, titles } : null;
    }
    if (typeof raw.runId !== 'string' || typeof raw.elementId !== 'string' || typeof raw.text !== 'string' || !raw.text) return null;
    return {
      kind: 'answer', runId: raw.runId, elementId: raw.elementId,
      elementTitle: typeof raw.elementTitle === 'string' ? raw.elementTitle : '',
      text: raw.text, question: typeof raw.question === 'string' ? raw.question : null,
    };
  } catch {
    return null;
  }
}

function work(step: ConversationStep): WorkItem | null {
  if (step.type === 'plan_request') return { id: step.id, name: 'hand_to_planner', kind: 'plan', detail: step.detail ?? '', ok: true };
  if (step.type === 'start_request' || step.type === 'answer_request' || step.type === 'connection_request') {
    const kind = step.type === 'start_request' ? 'start' : step.type === 'answer_request' ? 'answer' : 'connect';
    return {
      id: step.id, name: kind === 'start' ? 'propose_run_start' : kind === 'answer' ? 'propose_answer' : 'propose_connection', kind,
      detail: '', ok: true, proposal: proposalOf(step),
    };
  }
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
  const tally = { write: 0, read: 0, web: 0, plan: 0, start: 0, answer: 0, connect: 0, failed: 0 };
  for (const w of items) {
    tally[w.kind] += 1;
    if (!w.ok) tally.failed += 1;
  }
  return tally;
}

/** A work item as a shared trace step (Function/shared/workTrace), so the
 *  conversation's opened list reads like every other run's steps. A
 *  failure's error is its detail; the hand-off to the Planner is a note,
 *  not work. */
export function traceStepFromWorkItem(item: WorkItem): TraceStep {
  return {
    id: item.id,
    label: WORK_LABEL[item.name] ?? item.name,
    chip: null,
    detail: item.ok ? (item.detail || null) : (item.error ?? item.detail ?? null),
    tone: !item.ok ? 'error' : item.kind === 'plan' || item.kind === 'start' || item.kind === 'answer' || item.kind === 'connect' ? 'note' : 'work',
  };
}
