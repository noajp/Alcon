import type { CopilotConnectionProposal, ToolEvent } from './useAlconCopilot';

// A Copilot turn in progress, read from its run's steps — the live
// display while Athena works, before the kept conversation carries the
// settled turn. The chat driver writes the steps (run-agent): the
// person's 'message', a step per tool result (its title the tool, its
// detail a JSON of the call's input and the result's rows or error),
// 'draft' steps holding the answer as it grows, 'reply' steps for
// each stretch of finished words, and a 'connection_request' step per
// connection proposal. Pure.

export interface CopilotStepRow { type: string; title: string; detail: string | null }

const TOOL_STEP_TYPES = new Set(['action', 'write', 'error']);

/** Pure. A connection_request step's ask, defensively parsed — a step
 *  whose detail is not the proposal's JSON is not a proposal. */
function proposalOf(step: CopilotStepRow): CopilotConnectionProposal | null {
  try {
    const parsed = JSON.parse(step.detail ?? '') as { names?: unknown; waitingFor?: unknown };
    const names = Array.isArray(parsed?.names)
      ? parsed.names.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      : [];
    const waitingFor = typeof parsed?.waitingFor === 'string' ? parsed.waitingFor : '';
    return names.length ? { names, waitingFor } : null;
  } catch {
    return null;
  }
}

/** Pure. The in-progress assistant turn a run's steps describe: the
 *  words so far (finished stretches, then the growing draft), the
 *  tool steps as the panel's tool events, and the connection proposals
 *  made so far (rendered as Connect cards). Steps before the latest
 *  'message' belong to earlier turns and are not this turn's. */
export function liveTurnFromSteps(steps: readonly CopilotStepRow[]): { content: string; toolEvents: ToolEvent[]; connections: CopilotConnectionProposal[] } {
  const start = steps.map((s) => s.type).lastIndexOf('message');
  const toolEvents: ToolEvent[] = [];
  const connections: CopilotConnectionProposal[] = [];
  const segments: string[] = [];
  let draft = '';
  for (const step of steps.slice(start + 1)) {
    if (step.type === 'connection_request') {
      const proposal = proposalOf(step);
      if (proposal) connections.push(proposal);
    } else if (step.type === 'reply') {
      const text = (step.detail ?? step.title).trim();
      if (text) segments.push(text);
    } else if (step.type === 'draft') {
      draft = step.detail ?? '';
    } else if (TOOL_STEP_TYPES.has(step.type)) {
      let input: Record<string, unknown> | undefined;
      let rows: number | undefined;
      let error: string | undefined;
      try {
        const parsed = JSON.parse(step.detail ?? '') as { input?: Record<string, unknown>; rows?: number; error?: string };
        if (parsed && typeof parsed === 'object') {
          input = parsed.input;
          rows = typeof parsed.rows === 'number' ? parsed.rows : undefined;
          error = typeof parsed.error === 'string' ? parsed.error : undefined;
        }
      } catch {
        // A step whose detail is not the driver's JSON still shows: a
        // failure's detail is its error, read plainly.
        if (step.type === 'error') error = step.detail ?? undefined;
      }
      toolEvents.push({
        name: step.title,
        ...(input ? { input } : {}),
        result: step.type === 'error'
          ? { ok: false, ...(error ? { error } : {}) }
          : { ok: true, ...(rows !== undefined ? { rows } : {}) },
      });
    }
  }
  const content = [...segments, ...(draft.trim() ? [draft] : [])].join('\n\n');
  return { content, toolEvents, connections };
}
