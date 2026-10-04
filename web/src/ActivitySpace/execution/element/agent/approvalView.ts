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
      ...readableFields(input),
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
