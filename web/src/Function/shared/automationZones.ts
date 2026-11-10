import type { ParsedDefinition } from '@/AIP/harness/harnessDefinition';
import { describeCron, nextCronRun } from '@/AIP/automation/cron';
import { graphFromWorkflow, parseWorkflowGraph, type WorkflowGraph } from '@/Function/shared/workflowGraph';

// The Automation builder's three zones (Automation builder design §4),
// as pure projections. An automation in the 837 shape carries its work
// in three homes: the row itself (when it starts, and the Object its
// firings land in), its own workflow (the steps Athena follows — the
// drawing in workflowGraph, whose text form the zones read here), and,
// for an automation that still follows one, its harness body (the
// definition: connectors, checks, the output's shape). The zones hold
// no state and write nothing: every block is a reading of those homes,
// so the list, the builder and the tests all see the same picture.
// Kinds with no machinery behind them (a file *arriving*, another run
// finishing, posting into a Strategy conversation — design §3.4) never
// appear here: a block exists only when a step or a row names it.

/** Pure. An automation's drawing: its stored graph when it has one,
 *  else its written workflow drawn as a line — the one reading both
 *  the list's step count and the builder's canvas start from. */
export function workflowGraphOf(a: { workflow: string | null; workflow_graph: unknown }): WorkflowGraph {
  return parseWorkflowGraph(a.workflow_graph) ?? graphFromWorkflow(a.workflow ?? '');
}

/** The schedule presets the surfaces offer, in one home: the new-
 *  automation form and the builder's trigger editor pick from the
 *  same list, so a preset means the same cron on both. Labels are
 *  i18n keys, translated where they render. */
export const AUTOMATION_CRON_PRESETS: { cron: string; label: string }[] = [
  { cron: '0 9 * * *', label: 'Every day at 9:00' },
  { cron: '0 9 * * 1-5', label: 'Weekdays at 9:00' },
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 9 * * 1', label: 'Mondays at 9:00' },
];

/** The row-owned facts of an automation — its binding (Automation
 *  builder design §5.3): when it starts (kind / cron / timezone),
 *  where its firings land (the Object), and the Element title and
 *  description templates a firing is created with. These are not
 *  body facts: editing them writes the automations row directly and
 *  takes effect at once, with no rehearsal. */
export interface AutomationBindingInput {
  kind: 'schedule' | 'webhook';
  cron: string | null;
  timezone: string;
  objectId: string;
  titleTemplate: string | null;
  descriptionTemplate: string | null;
}

/** The binding as the row stores it: snake-case columns, plus the
 *  recomputed next run. */
export interface AutomationBindingUpdate {
  kind: 'schedule' | 'webhook';
  cron: string | null;
  timezone: string;
  object_id: string;
  title_template: string | null;
  description_template: string | null;
  next_run_at: string | null;
}

/** Pure. A row's binding, in the input shape — the starting point a
 *  binding editor overrides one fact of, so an edit to one fact
 *  carries the others through unchanged. */
export function bindingInputOf(row: {
  kind: 'schedule' | 'webhook';
  cron: string | null;
  timezone: string;
  object_id: string;
  title_template?: string | null;
  description_template?: string | null;
}): AutomationBindingInput {
  return {
    kind: row.kind,
    cron: row.cron,
    timezone: row.timezone,
    objectId: row.object_id,
    titleTemplate: row.title_template ?? null,
    descriptionTemplate: row.description_template ?? null,
  };
}

function templateOrNull(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value : null;
}

/**
 * Pure. A binding edit shaped for the row, exactly as creating an
 * automation shapes it: a webhook carries no cron, a schedule's cron
 * is trimmed, an empty template is stored as none, and `next_run_at`
 * is recomputed from the new trigger — null for a webhook or a cron
 * that cannot be read or never runs. An empty timezone falls back to
 * Asia/Tokyo, the default the promotion binding and the cron reader
 * both use.
 */
export function bindingUpdateOf(input: AutomationBindingInput, now: Date): AutomationBindingUpdate {
  const cron = input.kind === 'schedule' ? input.cron?.trim() || null : null;
  const timezone = input.timezone.trim() || 'Asia/Tokyo';
  let nextRunAt: string | null = null;
  if (cron) {
    try { nextRunAt = nextCronRun(cron, now, timezone)?.toISOString() ?? null; } catch { nextRunAt = null; }
  }
  return {
    kind: input.kind,
    cron,
    timezone,
    object_id: input.objectId,
    title_template: templateOrNull(input.titleTemplate),
    description_template: templateOrNull(input.descriptionTemplate),
    next_run_at: nextRunAt,
  };
}

/** The part of an automation row the zones read. Structural, so the
 *  projections stay pure and testable without the data layer. */
export interface AutomationZoneRow {
  enabled: boolean;
  kind: 'schedule' | 'webhook';
  cron: string | null;
  timezone: string;
  object_id: string | null;
  next_run_at: string | null;
  last_fired_at: string | null;
  last_status: string | null;
}

/** The four-way status the list shows (design §4.1), plus the waiting
 *  mark. `at` is the instant the status speaks of (the next run, or the
 *  last firing), left for the surface to format. */
export type AutomationStatus =
  | { kind: 'off'; at: null; waiting: boolean }
  | { kind: 'failed'; at: string | null; waiting: boolean }
  | { kind: 'next'; at: string; waiting: boolean }
  | { kind: 'last'; at: string; waiting: boolean }
  | { kind: 'none'; at: null; waiting: boolean };

/**
 * Pure. The status of one automation: off first, then a failed last
 * start, then the next scheduled run, then the last firing — the same
 * order the Automation list has always read them in. `latestRunStatus`
 * is the newest start's run status, when the surface has read it: a run
 * parked on an approval marks the row as waiting, never as failed.
 */
export function automationStatusOf(
  row: Pick<AutomationZoneRow, 'enabled' | 'kind' | 'next_run_at' | 'last_fired_at' | 'last_status'>,
  latestRunStatus?: string | null,
): AutomationStatus {
  // The same state automationData's runWaitingOnApproval names,
  // inlined so this projection stays free of the data layer.
  const waiting = latestRunStatus === 'awaiting_approval';
  if (!row.enabled) return { kind: 'off', at: null, waiting };
  if (row.last_status === 'failed') return { kind: 'failed', at: row.last_fired_at, waiting };
  if (row.kind === 'schedule' && row.next_run_at) return { kind: 'next', at: row.next_run_at, waiting };
  if (row.last_fired_at) return { kind: 'last', at: row.last_fired_at, waiting };
  return { kind: 'none', at: null, waiting };
}

export type InputBlock =
  /** The row's one trigger, always present (design §3.1: one trigger
   *  per automation; combining means one trigger × declared inputs). */
  | { kind: 'trigger'; triggerKind: 'schedule' | 'webhook'; detail: string }
  /** A declared intake the run reads when it fires: a mail poll, or
   *  a poll of the Space's files. `stepIndex` points at the step that
   *  names it, in the order the surface passed the steps in — or is
   *  null when the block comes from the body's declared Input
   *  section (design §6), which names no step. */
  | { kind: 'mail' | 'files'; detail: string; stepIndex: number | null }
  /** A poll of another connection: the same composition as mail,
   *  under the connector's own name. */
  | { kind: 'source'; connector: string; detail: string; stepIndex: number | null };

export type OutputBlock =
  /** Where firings land, and the default home of ticketed Elements. */
  | { kind: 'target'; objectId: string | null; objectName: string | null }
  /** The harness's declared output shape (成果物の型), when it has one. */
  | { kind: 'artifact'; format: string; detail: string }
  /** One effect a step carries, grouped by the owner's vocabulary
   *  (design §4.3). A step that changes a Strategy is `gated`: from a
   *  run it only ever proposes, and a person approves. */
  | { kind: 'tickets' | 'files' | 'sends' | 'marks-processed' | 'strategy'; detail: string; stepIndex: number; gated: boolean };

/** A read command in a step names its connector's poll: the first
 *  `x_search` / `x_read` token in the step is its source. */
const READ_COMMAND = /\b([a-z][a-z0-9]*)_(search|read)\b/;
/** A file poll: the file tools a step names, or a step that speaks of
 *  reading the Space's files. */
const FILE_READ = /\b(searchFiles|listFiles)\b|ファイル(を|の).*(読|探|検索)/;

/**
 * Pure. The Input zone: the trigger block, then one source block per
 * declared intake. The body's Input section (design §6) is the
 * blocks' home when it declares rows: a connector row reads as a
 * Mail block when its name carries "mail" (Gmail included), a Source
 * block under its own name otherwise, and a ファイル row as a Files
 * block — each block's detail is the row's declared query or pattern,
 * and its stepIndex is null (the section names no step). For a body
 * that predates the section (or declares no rows), the step-reading
 * remains the fallback: a source is a *reading* of the step that
 * names it — used to display, never to write back — because polling
 * a connection for new work is the one intake composition that
 * exists today (design §3.1), and every block's detail then keeps
 * the step's own words, so nothing is invented.
 */
export function inputBlocksOf(row: AutomationZoneRow, steps: string[], parsed?: ParsedDefinition | null): InputBlock[] {
  let triggerDetail = '';
  if (row.kind === 'schedule') {
    try { triggerDetail = describeCron(row.cron ?? ''); } catch { triggerDetail = row.cron ?? ''; }
  }
  const blocks: InputBlock[] = [{ kind: 'trigger', triggerKind: row.kind, detail: triggerDetail }];
  if (parsed && parsed.inputs.length > 0) {
    for (const input of parsed.inputs) {
      if (input.kind === 'files') blocks.push({ kind: 'files', detail: input.detail, stepIndex: null });
      else if ((input.connector ?? '').toLowerCase().includes('mail')) blocks.push({ kind: 'mail', detail: input.detail, stepIndex: null });
      else blocks.push({ kind: 'source', connector: input.connector ?? input.source, detail: input.detail, stepIndex: null });
    }
    return blocks;
  }
  const seen = new Set<string>();
  steps.forEach((step, stepIndex) => {
    if (FILE_READ.test(step)) {
      if (!seen.has('files')) { seen.add('files'); blocks.push({ kind: 'files', detail: step, stepIndex }); }
      return;
    }
    const read = READ_COMMAND.exec(step);
    if (read && !seen.has(read[1])) {
      seen.add(read[1]);
      if (read[1] === 'gmail' || read[1].includes('mail')) blocks.push({ kind: 'mail', detail: step, stepIndex });
      else blocks.push({ kind: 'source', connector: read[1], detail: step, stepIndex });
    }
  });
  return blocks;
}

const TICKET = /\bcreateElement\b|Element\s*を\s*起票|起票する/;
const MARK_PROCESSED = /\bgmail_modify_labels\b/;
const SEND = /\b[a-z][a-z0-9]*_send\b|\bgmail_send\b/;
const FILE_WRITE = /\b(writeFile|saveTextFile)\b/;
const ARTIFACT_SAVE = /\bsave_artifact\b/;
const STRATEGY_WRITE = /\b(updateInitiative|addIntent|createInitiative)\b/;

/**
 * Pure. The Output zone: the target Object block, the harness's
 * artifact shape when it declares one, then one block per effect a
 * step carries, in step order. The blocks are views onto steps and
 * the binding — never records of their own (design §3.3: effects are
 * governed once, at the command layer; a second outputs declaration
 * would double-declare them).
 */
export function outputBlocksOf(
  row: AutomationZoneRow,
  parsed: ParsedDefinition | null,
  steps: string[],
  objectName: string | null,
): OutputBlock[] {
  const blocks: OutputBlock[] = [{ kind: 'target', objectId: row.object_id, objectName }];
  if (parsed?.output) {
    const firstLines = parsed.output.body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' ');
    blocks.push({ kind: 'artifact', format: parsed.output.format, detail: firstLines });
  }
  steps.forEach((step, stepIndex) => {
    if (MARK_PROCESSED.test(step)) blocks.push({ kind: 'marks-processed', detail: step, stepIndex, gated: false });
    else if (STRATEGY_WRITE.test(step)) blocks.push({ kind: 'strategy', detail: step, stepIndex, gated: true });
    else if (TICKET.test(step)) blocks.push({ kind: 'tickets', detail: step, stepIndex, gated: false });
    else if (SEND.test(step)) blocks.push({ kind: 'sends', detail: step, stepIndex, gated: false });
    else if (ARTIFACT_SAVE.test(step)) blocks.push({ kind: 'files', detail: step, stepIndex, gated: false });
    else if (FILE_WRITE.test(step)) blocks.push({ kind: 'files', detail: step, stepIndex, gated: false });
  });
  return blocks;
}
