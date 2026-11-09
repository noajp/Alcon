import type { CopilotConnectionProposal, CopilotCredentialAsk, CreatedEntity, ToolEvent } from './useAlconCopilot';

// A Copilot turn in progress, read from its run's steps — the live
// display while Athena works, before the kept conversation carries the
// settled turn. The chat driver writes the steps (run-agent): the
// person's 'message', a step per tool result (its title the tool, its
// detail a JSON of the call's input, the result's rows or error, and
// what the call created when it created Alcon entities),
// 'draft' steps holding the answer as it grows, 'reply' steps for
// each stretch of finished words, a 'connection_request' step per
// connection proposal, and a 'credential_request' step per credential
// capture the proposal created. Pure.

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

/** Pure. A tool step detail's created records, defensively parsed —
 *  each entry must carry a known kind, an id and a title to become a
 *  card record; anything else in the list is dropped, and a detail
 *  with no valid entry yields none. */
function createdOf(parsed: unknown): CreatedEntity[] | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const raw = (parsed as { created?: unknown }).created;
  if (!Array.isArray(raw)) return undefined;
  const out: CreatedEntity[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, id, title, displayId, status, objectId } = entry as Record<string, unknown>;
    if (kind !== 'element' && kind !== 'object' && kind !== 'strategy') continue;
    if (typeof id !== 'string' || !id || typeof title !== 'string' || !title) continue;
    out.push({
      kind, id, title,
      ...(typeof displayId === 'string' && displayId ? { displayId } : {}),
      ...(typeof status === 'string' && status ? { status } : {}),
      ...(typeof objectId === 'string' && objectId ? { objectId } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** Pure. A turn's created entities, from its tool events in order:
 *  creation is ordered work and the events are its chronological
 *  record, so the panel derives the card list by flattening them —
 *  deduped by kind + id, first wins (a later event never rewrites
 *  what an earlier one made). */
export function flattenCreated(events: readonly ToolEvent[]): CreatedEntity[] {
  const seen = new Set<string>();
  const out: CreatedEntity[] = [];
  for (const event of events) {
    for (const entity of event.created ?? []) {
      const key = `${entity.kind}:${entity.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entity);
    }
  }
  return out;
}

/** Pure. A credential_request step's ask, defensively parsed — the
 *  request id and its display label; the card re-reads the request
 *  row for everything else (its waiting work lives on the row). */
function credentialOf(step: CopilotStepRow): CopilotCredentialAsk | null {
  try {
    const parsed = JSON.parse(step.detail ?? '') as { requestId?: unknown; label?: unknown };
    const requestId = typeof parsed?.requestId === 'string' ? parsed.requestId : '';
    if (!requestId) return null;
    return { requestId, label: typeof parsed?.label === 'string' ? parsed.label : '', waitingFor: '' };
  } catch {
    return null;
  }
}

/** Pure. The in-progress assistant turn a run's steps describe: the
 *  words so far (finished stretches, then the growing draft), the
 *  tool steps as the panel's tool events, and the connection proposals
 *  made so far (rendered as Connect cards). Steps before the latest
 *  'message' belong to earlier turns and are not this turn's. */
export function liveTurnFromSteps(steps: readonly CopilotStepRow[]): { content: string; toolEvents: ToolEvent[]; connections: CopilotConnectionProposal[]; credentials: CopilotCredentialAsk[] } {
  const start = steps.map((s) => s.type).lastIndexOf('message');
  const toolEvents: ToolEvent[] = [];
  const connections: CopilotConnectionProposal[] = [];
  const credentials: CopilotCredentialAsk[] = [];
  const segments: string[] = [];
  let draft = '';
  for (const step of steps.slice(start + 1)) {
    if (step.type === 'connection_request') {
      const proposal = proposalOf(step);
      if (proposal) connections.push(proposal);
    } else if (step.type === 'credential_request') {
      const ask = credentialOf(step);
      if (ask) credentials.push(ask);
    } else if (step.type === 'reply') {
      const text = (step.detail ?? step.title).trim();
      if (text) segments.push(text);
    } else if (step.type === 'draft') {
      draft = step.detail ?? '';
    } else if (TOOL_STEP_TYPES.has(step.type)) {
      let input: Record<string, unknown> | undefined;
      let rows: number | undefined;
      let error: string | undefined;
      let created: CreatedEntity[] | undefined;
      try {
        const parsed = JSON.parse(step.detail ?? '') as { input?: Record<string, unknown>; rows?: number; error?: string };
        if (parsed && typeof parsed === 'object') {
          input = parsed.input;
          rows = typeof parsed.rows === 'number' ? parsed.rows : undefined;
          error = typeof parsed.error === 'string' ? parsed.error : undefined;
          created = createdOf(parsed);
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
        ...(created ? { created } : {}),
      });
    }
  }
  const content = [...segments, ...(draft.trim() ? [draft] : [])].join('\n\n');
  return { content, toolEvents, connections, credentials };
}
