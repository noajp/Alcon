// What the Memory settings screen works with: the row's domain view
// and the screen's pure judgements — whose hand may correct a memory
// (the RLS rule, restated so the screen can show the truth before the
// database is asked), how the list filters, and which durable
// procedures stand as harness candidates. The engine's decisions live
// in supabase/functions/_shared/memoryStore.ts; topicKeyOf here is
// its twin, pinned to it by tests so writer and screen key a fact the
// same way.

import type { Memory, MemoryKind, MemoryLayer } from '@/types/database';
export type { Memory };

/** Pure. A topic's key — the twin of memoryStore.topicKeyOf. */
export function topicKeyOf(topic: string | null | undefined): string | null {
  if (typeof topic !== 'string') return null;
  const key = topic.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return key || null;
}

/** Pure. A memory's fingerprint in a scope — the twin of
 *  memoryStore.fingerprintOf, over the row's stored key: what makes
 *  two rows in one scope the same memory. The share-to-Space copy is
 *  fingerprinted with it, so a Space that already holds the fact
 *  recognises the copy as its duplicate. */
export function fingerprintOf(
  m: { topic_key: string | null; title: string; element_id: string | null; strategy_id: string | null; integration_name: string | null },
  scope: 'space' | 'personal', spaceId: string | null, userId: string | null,
): string {
  const scopeKey = scope === 'space' ? `space:${spaceId ?? ''}` : `person:${userId ?? ''}`;
  const about = m.topic_key ?? `title:${m.title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const target = m.element_id ?? m.strategy_id ?? m.integration_name ?? '';
  return `${scopeKey}|${about}|${target}`;
}

export interface MemoryRowLike {
  id?: unknown; layer?: unknown; kind?: unknown; status?: unknown; scope?: unknown;
  activity_space_id?: unknown; user_id?: unknown; title?: unknown; gist?: unknown; body?: unknown;
  topic_key?: unknown; fingerprint?: unknown; element_id?: unknown; domain_id?: unknown; strategy_id?: unknown;
  integration_name?: unknown; origin?: unknown; created_by?: unknown; edited_by?: unknown;
  source_run_id?: unknown; source_session_id?: unknown; supersedes_id?: unknown;
  pinned?: unknown; use_count?: unknown; last_used_at?: unknown; expires_at?: unknown;
  created_at?: unknown; updated_at?: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const nullableText = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);

/** A memories row (as PostgREST returns it) as the screen's Memory. */
export function memoryOf(row: MemoryRowLike | null | undefined): Memory | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    layer: oneOf(row.layer, ['episode', 'durable'] as const, 'episode'),
    kind: oneOf(row.kind, ['event', 'procedure', 'fact'] as const, 'event'),
    status: oneOf(row.status, ['active', 'superseded', 'archived', 'expired'] as const, 'active'),
    scope: oneOf(row.scope, ['space', 'personal'] as const, 'personal'),
    activity_space_id: nullableText(row.activity_space_id),
    user_id: nullableText(row.user_id),
    title: text(row.title),
    gist: text(row.gist),
    body: text(row.body),
    topic_key: nullableText(row.topic_key),
    fingerprint: nullableText(row.fingerprint),
    element_id: nullableText(row.element_id),
    domain_id: nullableText(row.domain_id),
    strategy_id: nullableText(row.strategy_id),
    integration_name: nullableText(row.integration_name),
    origin: oneOf(row.origin, ['athena', 'person'] as const, 'athena'),
    created_by: nullableText(row.created_by),
    edited_by: nullableText(row.edited_by),
    source_run_id: nullableText(row.source_run_id),
    source_session_id: nullableText(row.source_session_id),
    supersedes_id: nullableText(row.supersedes_id),
    pinned: row.pinned === true,
    use_count: typeof row.use_count === 'number' ? row.use_count : 0,
    last_used_at: nullableText(row.last_used_at),
    expires_at: nullableText(row.expires_at),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
  };
}

/**
 * Pure. Whose hand may edit or delete this memory — the RLS rule
 * (migration 20261129090000) in the screen's terms: a Space memory is
 * its owner's, plus the person who wrote one of their own; a personal
 * memory is its person's alone. Athena's distilled Space memories
 * (no human creator) are the owner's to correct.
 */
export function canEditMemory(m: Memory, userId: string | null, isSpaceOwner: boolean): boolean {
  if (!userId) return false;
  if (m.scope === 'personal') return m.user_id === userId;
  return isSpaceOwner || (m.origin === 'person' && m.created_by === userId);
}

export interface MemoryFilter {
  layer: MemoryLayer | 'all';
  kind: MemoryKind | 'all';
  query: string;
  /** Superseded/archived/expired rows hide unless history is asked for. */
  showHistory: boolean;
}

/** Pure. The list's filtering: layer and kind by equality, the query
 *  by plain containment over title, gist and body (the screen's own
 *  small search — the engine's discovery search is the trgm RPC). */
export function filterMemories(rows: readonly Memory[], f: MemoryFilter): Memory[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((m) => {
    if (!f.showHistory && m.status !== 'active') return false;
    if (f.layer !== 'all' && m.layer !== f.layer) return false;
    if (f.kind !== 'all' && m.kind !== f.kind) return false;
    if (q && !`${m.title} ${m.gist} ${m.body}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Pure. The harness-promotion candidates: durable procedures, most
 * used first — the seam item 5 (Agent 化・ハーネス化) starts from.
 * A procedure a person pinned outranks an unpinned one at equal use.
 */
export function promotionCandidates(rows: readonly Memory[]): Memory[] {
  return rows
    .filter((m) => m.layer === 'durable' && m.kind === 'procedure' && m.status === 'active')
    .sort((a, b) => b.use_count - a.use_count || Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
}
