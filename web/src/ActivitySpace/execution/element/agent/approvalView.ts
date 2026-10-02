import type { AgentAction } from '@/types/database';

// What a person reads before approving: one row per external write, with
// the operation and the few fields that say what it will do. The raw input
// stays available on demand. Pure.

export interface ApprovalRow {
  id: string;
  integration: string;
  operation: string;
  /** The fields worth reading, flattened to text: [label, value]. */
  fields: [string, string][];
  raw: Record<string, unknown>;
}

const SKIP = new Set(['method', 'path']);
const MAX_VALUE = 160;

function show(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length <= 3 && v.every((x) => typeof x !== 'object') ? v.join(', ') : `${v.length} 件`;
  const s = JSON.stringify(v);
  return s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s;
}

/** Pure. The readable fields of one call's input: its body for HTTP calls, its arguments otherwise. */
export function readableFields(input: Record<string, unknown>): [string, string][] {
  const source = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? (input.body as Record<string, unknown>)
    : input;
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(source)) {
    if (source === input && SKIP.has(k)) continue;
    out.push([k, show(v)]);
    if (out.length >= 6) break;
  }
  if (source !== input && typeof input.body === 'string') out.push(['body', show(input.body)]);
  return out;
}

/** Pure. The approval card's rows for a pending action. */
export function approvalRows(action: Pick<AgentAction, 'input'>): ApprovalRow[] {
  const calls = action.input?.calls ?? [];
  const display = new Map((((action.input as { display?: { id: string; integration: string; operation: string }[] })?.display) ?? []).map((d) => [d.id, d]));
  return calls.map((c) => {
    const d = display.get(c.id);
    const input = c.input ?? {};
    const httpOp = typeof input.method === 'string' ? `${input.method} ${typeof input.path === 'string' ? input.path : ''}`.trim() : '';
    return {
      id: c.id,
      integration: d?.integration ?? c.name.split('__')[0],
      operation: d?.operation || httpOp || c.name.split('__').slice(1).join('__') || c.name,
      fields: readableFields(input),
      raw: input,
    };
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
