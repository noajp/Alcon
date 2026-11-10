import type { AgentAction, AgentRunStatus } from '@/types/database';
import { approvalRows } from '@/Function/shared/approvalCardModel';
import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import type { CriticalClass } from '@/AIP/connectors/catalog';

// The Execute popup's readings, pure: which state the popup stands in,
// derived from the target Element's open (or latest) run and its resting
// action — the same facts useAgentRun hands every other surface — and
// how a sealed plan's calls read, from the plan action the machinery
// itself built. Nothing here starts, decides or cancels anything; the
// dialog (ExecutePlanDialog) acts on what this model says.

/** A run that is still its Element's run: one at a time (agentData's
 *  AGENT_RUN_OPEN_STATUSES, mirrored — this model stays import-free). */
const OPEN_STATUSES: readonly AgentRunStatus[] = ['queued', 'running', 'awaiting_approval', 'paused'];

export type PlanPopupState =
  /** No open run — the popup has just opened and its plan start is in flight. */
  | 'idle'
  /** A plan run is walking the work: reads live, writes recorded. */
  | 'planning'
  /** A plan run rests on its sealed plan: one approval unit, ready to execute. */
  | 'plan-ready'
  /** A non-plan run is working (an approved plan being applied, or a run
   *  that was already going when the popup opened). */
  | 'applying'
  /** A run rests on an ordinary (non-plan) approval. */
  | 'resting'
  /** The latest run is finished; the board's own badges take over. */
  | 'done';

export interface PlanPopupRunFacts {
  status: AgentRunStatus;
  plan_mode?: boolean | null;
}

export interface PlanPopupPendingFacts {
  tool: string;
}

/**
 * Pure. The popup's state from the Element's run and its resting action,
 * and whether the run is someone else's to decide — a run started by
 * another person renders the same states read-only in every one of them.
 */
export function planPopupState(
  run: PlanPopupRunFacts | null | undefined,
  pending: PlanPopupPendingFacts | null | undefined,
  isMine: boolean,
): { state: PlanPopupState; readOnly: boolean } {
  if (!run) return { state: 'idle', readOnly: false };
  if (!OPEN_STATUSES.includes(run.status)) return { state: 'done', readOnly: false };
  const readOnly = !isMine;
  if (run.status === 'awaiting_approval' && pending) {
    return { state: pending.tool === 'plan' ? 'plan-ready' : 'resting', readOnly };
  }
  return { state: run.plan_mode ? 'planning' : 'applying', readOnly };
}

// ── The sealed plan's calls ─────────────────────────────────────────────
// A sealed plan action (tool 'plan') carries its calls and the displays
// the approval machinery built for each at plan time (run-agent's
// planDisplay): the verify expectation as a labeled "読み戻し確認" field,
// a policy denial as a "ポリシー" field, an assembly problem as a
// "組み立て" field. Those three are the call's own verdicts, not ordinary
// argument fields, so this reading lifts them out of the field list and
// names them for what they are — the machinery's own words, verbatim.

const EXPECTED_FIELD_LABEL = '読み戻し確認';
const DENIED_FIELD_LABEL = 'ポリシー';
const PROBLEM_FIELD_LABEL = '組み立て';

export interface PlanPopupCall {
  id: string;
  /** The call as a person reads it ("Create a pull request"). */
  title: string;
  integration: string;
  destination: string;
  /** The display's present fields, minus the three verdict fields above. */
  fields: [string, string][];
  preview: string | null;
  critical: CriticalClass | null;
  /** The verify read-back line (expectedNote), in the machinery's words. */
  expectedNote: string | null;
  /** Set when policy refuses this call even under approval: the plain
   *  consequence, in the machinery's words. A denied call never runs. */
  deniedNote: string | null;
  /** Why the call could not be assembled at plan time, when it could not. */
  problem: string | null;
}

/** Pure. A sealed plan action's ordered calls, as the popup lists them. */
export function planCallsFromAction(action: Pick<AgentAction, 'input'>): PlanPopupCall[] {
  const display = ((action.input as { display?: unknown } | null)?.display ?? []) as {
    id?: unknown; fields?: { label: string; value: string }[];
  }[];
  const displayById = new Map(display.filter((d) => typeof d?.id === 'string').map((d) => [d.id as string, d]));
  return approvalRows(action).map((row) => {
    const rawFields = displayById.get(row.id)?.fields ?? [];
    const verdict = (label: string) => rawFields.find((f) => f.label === label)?.value ?? null;
    return {
      id: row.id,
      title: row.title,
      integration: row.integration,
      destination: row.destination,
      fields: row.fields.filter(([label]) => label !== EXPECTED_FIELD_LABEL && label !== DENIED_FIELD_LABEL && label !== PROBLEM_FIELD_LABEL),
      preview: row.preview,
      critical: row.critical,
      expectedNote: verdict(EXPECTED_FIELD_LABEL),
      deniedNote: verdict(DENIED_FIELD_LABEL),
      problem: verdict(PROBLEM_FIELD_LABEL),
    };
  });
}

/**
 * Pure. The declared outline of an Element-scope definition: its
 * Procedure lines, read by the same parse the flow projection reads.
 * Empty when the definition declares no procedure — the popup then
 * shows no outline rather than inventing one.
 */
export function procedureLines(definitionBody: string): string[] {
  const procedure = parseDefinition(definitionBody).sections.procedure;
  return procedure
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*・]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}
