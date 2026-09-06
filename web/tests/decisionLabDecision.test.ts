import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Intent, IntentInsert } from '@/types/database';

const database = vi.hoisted(() => ({
  userId: 'current-user' as string | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  writes: [] as { table: string; row: Record<string, unknown>; options: { onConflict: string; ignoreDuplicates?: boolean } }[],
  reads: [] as { table: string; filters: [string, unknown][] }[],
  failures: new Set<string>(),
  emptyRead: new Set<string>(),
  lostWriteResponse: new Set<string>(),
}));

vi.mock('@/lib/supabase', () => ({
  getCurrentUserId: vi.fn(async () => database.userId),
  supabase: {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const query = {
        async upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates?: boolean }) {
          database.writes.push({ table, row: structuredClone(row), options });
          if (database.failures.has(`${table}:write`)) return { error: { message: 'write unavailable' } };
          const rows = database.tables[table] ?? [];
          const fields = options.onConflict.split(',');
          const existing = rows.findIndex((saved) => fields.every((field) => saved[field] === row[field]));
          if (existing < 0) rows.push({ parent_intent_id: null, subtitle: null, ...row });
          else if (!options.ignoreDuplicates) rows[existing] = { ...rows[existing], ...row };
          database.tables[table] = rows;
          return { error: database.lostWriteResponse.has(table) ? { message: 'response lost' } : null };
        },
        select: () => query,
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        async single() {
          database.reads.push({ table, filters: [...filters] });
          if (database.failures.has(`${table}:read`)) return { data: null, error: { message: 'read unavailable' } };
          if (database.emptyRead.has(table)) return { data: null, error: null };
          const rows = (database.tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
          return { data: rows.length === 1 ? structuredClone(rows[0]) : null, error: rows.length === 1 ? null : { message: 'row missing' } };
        },
      };
      return query;
    },
  },
}));

import { recordDecisionLabDecision } from '@/hooks/decisionLabDecision';

function decision(extra: Partial<IntentInsert> = {}): IntentInsert & { id: string } {
  return {
    id: 'stable-decision', strategy_id: 'initiative', parent_intent_id: 'root-intent',
    kind: 'decision', title: 'Focus launch', subtitle: 'Why: customer commitment',
    abandoned: 'Other work finishes two days later.', slug: 'decision-lab',
    status: 'on_track', decided_at: '2026-09-07T00:00:00.000Z', order_index: 1, ...extra,
  };
}

describe('Decision Lab decision persistence', () => {
  beforeEach(() => {
    database.userId = 'current-user';
    database.tables = { intents: [], intent_bindings: [] };
    database.writes = [];
    database.reads = [];
    database.failures.clear();
    database.emptyRead.clear();
    database.lostWriteResponse.clear();
  });

  it('requires a signed-in user before making any database write', async () => {
    database.userId = null;
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('Sign in');
    expect(database.writes).toEqual([]);
    expect(database.reads).toEqual([]);
  });

  it('records the current owner and verifies both the decision and its exact Element binding', async () => {
    const result = await recordDecisionLabDecision(decision({ created_by: 'untrusted-owner' }), 'stable-binding', 'target');
    expect(result).toMatchObject({ ...decision(), created_by: 'current-user' });
    expect(database.writes[0]).toMatchObject({ table: 'intents', row: { id: 'stable-decision', created_by: 'current-user' }, options: { onConflict: 'id', ignoreDuplicates: true } });
    expect(database.writes[1]).toEqual({ table: 'intent_bindings', row: {
      id: 'stable-binding', intent_id: 'stable-decision', target_type: 'element', target_id: 'target', relationship_type: 'delivers',
    }, options: { onConflict: 'intent_id,target_type,target_id,relationship_type', ignoreDuplicates: true } });
    expect(database.reads).toEqual([
      { table: 'intents', filters: [['id', 'stable-decision']] },
      { table: 'intent_bindings', filters: [['intent_id', 'stable-decision'], ['target_type', 'element'], ['target_id', 'target'], ['relationship_type', 'delivers']] },
    ]);
    expect(database.writes.every((write) => write.table === 'intents' || write.table === 'intent_bindings')).toBe(true);
  });

  it('retries stable ids without duplicating or overwriting the decision or binding', async () => {
    const payload = decision();
    const first = await recordDecisionLabDecision(payload, 'stable-binding', 'target');
    const second = await recordDecisionLabDecision(payload, 'stable-binding', 'target');
    expect(second).toEqual(first);
    expect(database.tables.intents).toHaveLength(1);
    expect(database.tables.intent_bindings).toHaveLength(1);
    expect(database.writes.filter((write) => write.table === 'intents').map((write) => write.row.id)).toEqual(['stable-decision', 'stable-decision']);
    expect(database.writes.every((write) => write.options.ignoreDuplicates === true)).toBe(true);
    expect(payload).toEqual(decision());
  });

  it('can confirm the same record after the insert succeeded but its response was lost', async () => {
    database.lostWriteResponse.add('intents');
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('Retry to confirm this same record');
    expect(database.tables.intents).toHaveLength(1);
    expect(database.tables.intent_bindings).toHaveLength(0);
    database.lostWriteResponse.clear();
    await recordDecisionLabDecision(decision(), 'stable-binding', 'target');
    expect(database.tables.intents).toHaveLength(1);
    expect(database.tables.intent_bindings).toHaveLength(1);
  });

  it('reports a saved decision separately from a failed Element link and completes that link on retry', async () => {
    database.failures.add('intent_bindings:write');
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('The decision is saved, but its Element link could not be saved');
    expect(database.tables.intents).toHaveLength(1);
    expect(database.tables.intent_bindings).toHaveLength(0);
    database.failures.clear();
    await recordDecisionLabDecision(decision(), 'stable-binding', 'target');
    expect(database.tables.intents).toHaveLength(1);
    expect(database.tables.intent_bindings).toHaveLength(1);
  });

  it('does not report success when the saved Element binding cannot be verified', async () => {
    database.failures.add('intent_bindings:read');
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('The decision is saved. Its Element link could not be confirmed');
    expect(database.tables.intents).toHaveLength(1);
    expect(database.tables.intent_bindings).toHaveLength(1);
  });

  it('does not try linking a decision whose saved record could not be read back', async () => {
    database.failures.add('intents:read');
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('Could not confirm the saved decision');
    expect(database.writes.map((write) => write.table)).toEqual(['intents']);
  });

  it('does not accept an empty decision readback', async () => {
    database.emptyRead.add('intents');
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('Could not confirm the saved decision');
    expect(database.tables.intent_bindings).toHaveLength(0);
  });

  it.each([
    ['strategy_id', 'other-initiative'],
    ['parent_intent_id', 'other-parent'],
    ['subtitle', 'A different decision rationale'],
    ['title', 'A different adopted plan'],
    ['abandoned', 'A different sacrifice'],
    ['kind', 'assumption'],
    ['created_by', 'other-owner'],
  ])('preserves an existing row with a different %s and stops before creating a link', async (field, value) => {
    const saved = { ...decision(), created_by: 'current-user', [field]: value };
    database.tables.intents = [saved];
    await expect(recordDecisionLabDecision(decision(), 'stable-binding', 'target')).rejects.toThrow('changed elsewhere');
    expect(database.tables.intents).toEqual([saved]);
    expect(database.tables.intent_bindings).toEqual([]);
    expect(database.writes.map((write) => write.table)).toEqual(['intents']);
  });

  it('returns the persisted record including database-owned fields', async () => {
    const saved = { ...decision(), created_by: 'current-user', created_at: '2026-09-07T00:01:00.000Z', updated_at: '2026-09-07T00:01:00.000Z' } as Intent;
    database.tables.intents = [{ ...saved }];
    expect(await recordDecisionLabDecision(decision(), 'stable-binding', 'target')).toEqual(saved);
  });
});
