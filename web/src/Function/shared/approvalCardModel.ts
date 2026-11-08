import type { AgentAction } from '@/types/database';
import type { CriticalClass } from '@/AIP/connectors/catalog';

// What a person reads before approving: one row per external write, with
// the action as a sentence, the labeled fields the decision turns on,
// and the content preview when the command declares one. The raw input
// stays available on demand. Pure.
//
// Displays come in two generations and this model reads both alike: v2
// (written by the engine since the presentation data landed) carries a
// title, labeled fields, a preview and the reason the call is asked
// about; v1 rows (holds persisted before that) derive exactly the rows
// the old approvalView derived — the operation line, the readable-fields
// flattening, a humanized title. No migration, no backfill.

/** Why one call is being asked about (the engine's AskReason vocabulary). */
export type ApprovalAskReason = 'critical' | 'command' | 'rule' | 'mode' | 'http' | 'catalog';

export interface ApprovalRow {
  id: string;
  integration: string;
  operation: string;
  /** The action as a person reads it: "Create a pull request". */
  title: string;
  /** Where the call goes: the connection's base URL (or "Alcon"). */
  destination: string;
  /** A manifest HTTP command's resolved request line, when it has one. */
  detail: string | null;
  effect: 'read' | 'write';
  /** The critical class the engine derived for this call, if any. */
  critical: CriticalClass | null;
  /** Whether approving may offer "don't ask again" for this call. */
  rememberable: boolean;
  /** The fields worth reading, as [label, value]: the display's labeled
   *  fields on a v2 row, the readable-fields flattening otherwise. */
  fields: [string, string][];
  /** How many input fields the row leaves out; the raw input has them. */
  more: number;
  /** The content the decision turns on (a PR body, a file's content, a
   *  message), when the command declares a preview argument. */
  preview: string | null;
  /** Why this call is being asked about, when its own facts name one. */
  askReason: ApprovalAskReason | null;
  raw: Record<string, unknown>;
}

const MAX_VALUE = 160;
const MAX_FIELDS = 6;

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.length <= 3 && v.every((x) => typeof x !== 'object')) return v.join(', ');
  const s = JSON.stringify(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s;
}

/**
 * Pure. The readable fields of one call's input — for an HTTP call its query
 * and body, otherwise its arguments — and how many were left out.
 */
export function readableFields(input: Record<string, unknown>): { fields: [string, string][]; more: number } {
  const isHttp = typeof input.method === 'string';
  const all: [string, string][] = [];
  if (isHttp) {
    if (input.query && typeof input.query === 'object') {
      for (const [k, v] of Object.entries(input.query as Record<string, unknown>)) all.push([`?${k}`, show(v)]);
    }
    if (input.body && typeof input.body === 'object' && !Array.isArray(input.body)) {
      for (const [k, v] of Object.entries(input.body as Record<string, unknown>)) all.push([k, show(v)]);
    } else if (input.body !== undefined && input.body !== null) {
      all.push(['body', show(input.body)]);
    }
  } else {
    for (const [k, v] of Object.entries(input)) all.push([k, show(v)]);
  }
  return { fields: all.slice(0, MAX_FIELDS), more: Math.max(0, all.length - MAX_FIELDS) };
}

/**
 * Pure. A sentence-shaped title from an operation or tool name:
 * "chat.postMessage" → "Post message", "create_pull_request" →
 * "Create pull request". The web mirror of the engine's humanizer
 * (integrationTools.ts) — v1 displays carry no title, so the card
 * derives the same one the engine would have.
 */
export function humanizedTitle(operation: string): string {
  const last = operation.split('.').pop() ?? operation;
  const words = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\-\s]+/).filter(Boolean).join(' ').toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : operation;
}

interface DisplayEntry {
  id: string; integration: string; operation: string;
  destination?: string; detail?: string | null; effect?: string; critical?: CriticalClass | null; rememberable?: boolean;
  // Display v2 (all optional; a v1 entry has none of them).
  title?: string; fields?: { label: string; value: string }[]; preview?: string | null; askReason?: string | null;
}

function displayOf(action: Pick<AgentAction, 'input'>): Map<string, DisplayEntry> {
  return new Map((((action.input as { display?: DisplayEntry[] })?.display) ?? []).map((d) => [d.id, d]));
}

const ASK_REASONS: readonly string[] = ['critical', 'command', 'rule', 'mode', 'http', 'catalog'];

/** Pure. The approval card's rows for a pending action. */
export function approvalRows(action: Pick<AgentAction, 'input'>): ApprovalRow[] {
  const calls = action.input?.calls ?? [];
  const display = displayOf(action);
  return calls.map((c) => {
    const d = display.get(c.id);
    const input = c.input ?? {};
    const httpOp = typeof input.method === 'string' ? `${input.method} ${typeof input.path === 'string' ? input.path : ''}`.trim() : '';
    const integration = d?.integration ?? c.name.split('__')[0];
    const operation = d?.operation || httpOp || c.name.split('__').slice(1).join('__') || c.name;
    const readable = readableFields(input);
    const readableTotal = readable.fields.length + readable.more;
    // A v2 display's labeled fields win; an empty labeled set (a
    // presentation whose arguments are absent) falls back to the
    // flattening rather than showing nothing.
    const labeled: [string, string][] | null = typeof d?.title === 'string' && d.fields?.length
      ? d.fields.map((f) => [f.label, f.value] as [string, string])
      : null;
    return {
      id: c.id,
      integration,
      operation,
      title: d?.title ?? humanizedTitle(operation),
      // Actions saved before the display carried these default to the safe
      // side: no destination beyond the connection's name, not critical,
      // and not rememberable.
      destination: d?.destination ?? integration,
      detail: d?.detail ?? null,
      effect: d?.effect === 'read' ? 'read' as const : 'write' as const,
      critical: d?.critical ?? null,
      rememberable: d?.rememberable === true,
      fields: labeled ?? readable.fields,
      more: labeled ? Math.max(0, readableTotal - labeled.length) : readable.more,
      preview: typeof d?.preview === 'string' && d.preview ? d.preview : null,
      askReason: d?.askReason && ASK_REASONS.includes(d.askReason) ? d.askReason as ApprovalAskReason : null,
      raw: input,
    };
  });
}

/**
 * Pure. The card's headline: the action as one sentence — the first
 * call's integration and title ("GitHub · Create a pull request"), a
 * uniform batch appending "× n". A mixed batch has no single sentence;
 * the headline falls back to the action's grouped summary and the
 * per-call sections carry the detail.
 */
export function approvalHeadline(rows: ApprovalRow[], summary: string): string {
  if (!rows.length) return summary;
  const first = rows[0];
  const uniform = rows.every((r) => r.integration === first.integration && r.title === first.title);
  if (!uniform) return summary;
  return rows.length > 1 ? `${first.integration} · ${first.title} × ${rows.length}` : `${first.integration} · ${first.title}`;
}

/**
 * Pure. The compensation marker on an action (B9): this approval is
 * a FAILED run's rollback batch, not a turn's new work — approving
 * runs undo operations, and denying leaves the failed run's writes
 * standing. Read from the action's input exactly as the engine
 * wrote it; null for ordinary asks.
 */
export function compensationMarkerOf(action: Pick<AgentAction, 'input'>): { setSize: number; failureSummary: string } | null {
  const input = action.input as { compensation?: unknown } | null;
  const c = input?.compensation;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const m = c as { setSize?: unknown; failureSummary?: unknown };
  if (typeof m.setSize !== 'number' || typeof m.failureSummary !== 'string') return null;
  return { setSize: m.setSize, failureSummary: m.failureSummary };
}

/**
 * Pure. What a standing approval could be bound to: when every call is the
 * same operation, the short plain values they all share (an owner, a repo, a
 * recipient). Mirrors ruleFromCalls in the engine, which has the last word.
 */
export function rememberChoices(action: Pick<AgentAction, 'input'>): { field: string; value: string }[] {
  const calls = action.input?.calls ?? [];
  if (!calls.length || calls.some((c) => c.name !== calls[0].name)) return [];
  // Only a batch the engine marked rememberable on every call — a manifest
  // command that is not critical — may become a standing rule.
  const display = displayOf(action);
  if (calls.some((c) => display.get(c.id)?.rememberable !== true)) return [];
  const plain = (v: unknown) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : null);
  return Object.keys(calls[0].input ?? {}).flatMap((field) => {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(field)) return [];
    const values = calls.map((c) => plain((c.input ?? {})[field]));
    const v = values[0];
    if (v === null || v.length > 200 || v.includes('*') || values.some((x) => x !== v)) return [];
    return [{ field, value: v }];
  });
}

/** Pure. The columns shared by every row, when the batch is uniform (e.g. 20 replies) — a real table; else null. */
export function sharedColumns(rows: ApprovalRow[]): string[] | null {
  if (rows.length < 2) return null;
  const first = rows[0].fields.map(([k]) => k);
  if (!first.length) return null;
  const same = rows.every((r) => r.fields.length === first.length && r.fields.every(([k], i) => k === first[i]));
  return same ? first : null;
}
