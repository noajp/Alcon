import type { AgentAction } from '@/types/database';
import type { CriticalClass } from '@/AIP/connectors/catalog';

// What a person reads before approving: one row per external write, with
// the operation and the few fields that say what it will do. The raw input
// stays available on demand. Pure.

export interface ApprovalRow {
  id: string;
  integration: string;
  operation: string;
  /** Where the call goes: the connection's base URL (or "Alcon"). */
  destination: string;
  /** A manifest HTTP command's resolved request line, when it has one. */
  detail: string | null;
  effect: 'read' | 'write';
  /** The critical class the engine derived for this call, if any. */
  critical: CriticalClass | null;
  /** Whether approving may offer "don't ask again" for this call. */
  rememberable: boolean;
  /** The fields worth reading, flattened to text: [label, value]. */
  fields: [string, string][];
  /** How many fields the table leaves out; the raw input has them. */
  more: number;
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

interface DisplayEntry {
  id: string; integration: string; operation: string;
  destination?: string; detail?: string | null; effect?: string; critical?: CriticalClass | null; rememberable?: boolean;
}

function displayOf(action: Pick<AgentAction, 'input'>): Map<string, DisplayEntry> {
  return new Map((((action.input as { display?: DisplayEntry[] })?.display) ?? []).map((d) => [d.id, d]));
}

/** Pure. The approval card's rows for a pending action. */
export function approvalRows(action: Pick<AgentAction, 'input'>): ApprovalRow[] {
  const calls = action.input?.calls ?? [];
  const display = displayOf(action);
  return calls.map((c) => {
    const d = display.get(c.id);
    const input = c.input ?? {};
    const httpOp = typeof input.method === 'string' ? `${input.method} ${typeof input.path === 'string' ? input.path : ''}`.trim() : '';
    const integration = d?.integration ?? c.name.split('__')[0];
    return {
      id: c.id,
      integration,
      operation: d?.operation || httpOp || c.name.split('__').slice(1).join('__') || c.name,
      // Actions saved before the display carried these default to the safe
      // side: no destination beyond the connection's name, not critical,
      // and not rememberable.
      destination: d?.destination ?? integration,
      detail: d?.detail ?? null,
      effect: d?.effect === 'read' ? 'read' as const : 'write' as const,
      critical: d?.critical ?? null,
      rememberable: d?.rememberable === true,
      ...readableFields(input),
      raw: input,
    };
  });
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
