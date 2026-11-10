import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Automation builder PR4 (design §5.2/§5.4): the builder's drafts.
// New automations enter through promotion_drafts with source_kind
// 'builder' and the seed written at insert; a live automation's body
// edit is a trigger-less update draft against its definition; and a
// revision of a drafting draft is the P4 guarded write with the
// drafting guard — body, status and the clearing of the tested
// record in one statement. The builder itself never direct-saves a
// body: the last test pins the absence of updateDefinition from the
// builder surface.

const h = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  updates: [] as { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[],
  invokes: [] as { name: string; body: unknown }[],
  openDrafts: [] as Record<string, unknown>[],
  seededInsertFails: false,
}));

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const state: { op: string | null; payload: Record<string, unknown> | null; filters: Record<string, unknown> } = {
      op: null, payload: null, filters: {},
    };
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: (k: string, v: unknown) => { state.filters[k] = v; return q; },
      in: (k: string, v: unknown) => { state.filters[k] = v; return q; },
      insert: (row: Record<string, unknown>) => {
        state.op = 'insert'; state.payload = row;
        h.inserts.push({ table, row });
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        state.op = 'update'; state.payload = patch;
        h.updates.push({ table, patch, filters: state.filters });
        return q;
      },
      single: async () => {
        if (state.op === 'insert' && table === 'promotion_drafts') {
          if (h.seededInsertFails && state.payload && 'body' in state.payload) {
            return { data: null, error: { message: 'insert policy narrowed' } };
          }
          return { data: { id: 'd1', events: [], status: 'drafting', ...state.payload }, error: null };
        }
        if (state.op === 'insert') return { data: { id: 'run-1' }, error: null };
        if (state.op === 'update') return { data: { id: 'd1', events: [], ...state.payload }, error: null };
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        if (state.op === 'update') return Promise.resolve({ data: [{ id: 'd1' }], error: null }).then(resolve);
        return Promise.resolve({ data: h.openDrafts, error: null }).then(resolve);
      },
    };
    return q;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => chain(table),
      functions: {
        invoke: async (name: string, opts: { body: unknown }) => {
          h.invokes.push({ name, body: opts.body });
          return { error: null };
        },
      },
    },
  };
});

import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import {
  builderDraftInsertOf, builderSeedBodyOf, builderUpdateBindingOf, createBuilderDraft,
  reviseDraftBody, revisePromotionDraftBody,
} from '@/AIP/harness/promotionData';
import type { PromotionDraft } from '@/types/database';

const BINDING = {
  objectId: 'obj-1', titleTemplate: '', descriptionTemplate: '',
  trigger: { kind: 'schedule' as const, cron: '0 9 * * 1-5', timezone: 'Asia/Tokyo' },
};

const draftRow = (over: Partial<PromotionDraft> = {}): PromotionDraft => ({
  id: 'd1', activity_space_id: 's1', status: 'drafting', source_kind: 'builder',
  source_memory_id: null, source_run_id: null, target_definition_id: null,
  requester_id: 'user-1', name: '種', body: '# 目的\n種', binding: BINDING,
  base_definition_hash: null, tested_structure_hash: 'tested-s', tested_binding_hash: 'tested-b',
  draft_run_id: 'run-1', rehearsal_run_id: 'run-2', rehearsal_report: null,
  failure_class: null, awaiting_question: null, material_sources: [],
  activated_definition_id: null, activated_automation_id: null, activated_body: null,
  activated_structure_hash: null, activated_binding_hash: null, decided_by: null, decided_at: null,
  events: [], expires_at: null, created_by: 'user-1',
  created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z',
  ...over,
});

beforeEach(() => {
  h.inserts.length = 0; h.updates.length = 0; h.invokes.length = 0;
  h.openDrafts = []; h.seededInsertFails = false;
});

describe('builder draft shaping (pure)', () => {
  it('the insert row carries the builder source and the seed', () => {
    const row = builderDraftInsertOf({
      spaceId: 's1', userId: 'user-1', targetDefinitionId: 'def-1',
      seedName: 'クレーム処理', seedBody: '# 目的\n…', binding: BINDING,
    });
    expect(row.source_kind).toBe('builder');
    expect(row.source_memory_id).toBeNull();
    expect(row.source_run_id).toBeNull();
    expect(row.status).toBe('drafting');
    expect(row.target_definition_id).toBe('def-1');
    expect(row.name).toBe('クレーム処理');
    expect(row.body).toBe('# 目的\n…');
    expect(row.binding).toBe(BINDING);
    expect(row.created_by).toBe('user-1');
    expect(row.requester_id).toBe('user-1');
  });

  it('an update draft’s binding is trigger-less', () => {
    const binding = builderUpdateBindingOf({ objectId: 'obj-9', titleTemplate: 't', descriptionTemplate: null });
    expect(binding).toEqual({ objectId: 'obj-9', titleTemplate: 't', descriptionTemplate: '', trigger: null });
  });

  it('the seed skeleton parses, with the gate’s cost ceiling already in it', () => {
    const body = builderSeedBodyOf('朝の問い合わせ仕分け');
    const parsed = parseDefinition(body);
    expect(parsed.sections.goal).toBe('朝の問い合わせ仕分け');
    expect(parsed.stop.budgetUsd).toBe(2);
    for (const heading of ['# 進め方', '# 点検', '# 成果物の型', '# 使うコネクタ', '# 入力']) {
      expect(body).toContain(heading);
    }
  });
});

describe('createBuilderDraft', () => {
  it('creates a builder draft with the seed, then its drafting run, and starts it', async () => {
    const made = await createBuilderDraft('s1', {
      seedName: 'クレーム処理', seedBody: builderSeedBodyOf('クレーム処理'), binding: BINDING,
    });
    const draftInsert = h.inserts.find((i) => i.table === 'promotion_drafts');
    expect(draftInsert?.row.source_kind).toBe('builder');
    expect(draftInsert?.row.name).toBe('クレーム処理');
    expect(draftInsert?.row.body).toContain('# 目的');
    expect((draftInsert?.row.binding as typeof BINDING).trigger?.cron).toBe('0 9 * * 1-5');
    const runInsert = h.inserts.find((i) => i.table === 'agent_runs');
    expect(runInsert?.row).toMatchObject({ promotion_draft_id: made.id, mode: 'promote', triggered_from: 'automation_builder' });
    expect(h.invokes).toEqual([{ name: 'run-agent', body: { runId: 'run-1' } }]);
  });

  it('an update draft targets the definition and carries no trigger', async () => {
    await createBuilderDraft('s1', {
      targetDefinitionId: 'def-1', seedName: '既存', seedBody: '# 目的\n既存の本文',
      binding: builderUpdateBindingOf({ objectId: 'obj-1' }),
    });
    const draftInsert = h.inserts.find((i) => i.table === 'promotion_drafts');
    expect(draftInsert?.row.target_definition_id).toBe('def-1');
    expect((draftInsert?.row.binding as { trigger: unknown }).trigger).toBeNull();
  });

  it('joins an open draft already targeting the definition instead of rivalling it', async () => {
    h.openDrafts = [draftRow({ id: 'existing', target_definition_id: 'def-1' }) as unknown as Record<string, unknown>];
    const made = await createBuilderDraft('s1', {
      targetDefinitionId: 'def-1', seedName: '既存', seedBody: '# 目的\n…',
      binding: builderUpdateBindingOf({ objectId: 'obj-1' }),
    });
    expect(made.id).toBe('existing');
    expect(h.inserts).toHaveLength(0);
  });

  it('falls back to a bare insert plus the revision write when the seeded insert is refused', async () => {
    h.seededInsertFails = true;
    const made = await createBuilderDraft('s1', {
      seedName: '種の名前', seedBody: '# 目的\n種の本文', binding: BINDING,
    });
    expect(made.id).toBe('d1');
    // Two inserts: the refused seeded one, then the bare one; the
    // seed lands through the drafting revision + a name/binding update.
    expect(h.inserts.filter((i) => i.table === 'promotion_drafts')).toHaveLength(2);
    const revision = h.updates.find((u) => u.patch.body === '# 目的\n種の本文');
    expect(revision?.filters.status).toBe('drafting');
    const seedUpdate = h.updates.find((u) => u.patch.name === '種の名前');
    expect(seedUpdate?.patch.binding).toBe(BINDING);
  });
});

describe('the revision writes — hash invalidation, both guards', () => {
  it('reviseDraftBody clears the tested record in one drafting-guarded update', async () => {
    await reviseDraftBody(draftRow(), '# 目的\n書き直した本文');
    expect(h.updates).toHaveLength(1);
    const { patch, filters } = h.updates[0];
    expect(filters).toMatchObject({ id: 'd1', status: 'drafting' });
    expect(patch).toMatchObject({
      body: '# 目的\n書き直した本文',
      status: 'drafting',
      tested_structure_hash: null,
      tested_binding_hash: null,
      rehearsal_report: null,
      rehearsal_run_id: null,
      failure_class: null,
      awaiting_question: null,
      expires_at: null,
    });
    const events = patch.events as { kind: string; by: string }[];
    expect(events[events.length - 1]).toMatchObject({ kind: 'revised', by: 'user-1' });
  });

  it('revisePromotionDraftBody (the P4 precedent) keeps the awaiting_review guard and the same clearing', async () => {
    await revisePromotionDraftBody(draftRow({ status: 'awaiting_review' }), '# 目的\n審査での編集');
    const { patch, filters } = h.updates[0];
    expect(filters).toMatchObject({ id: 'd1', status: 'awaiting_review' });
    expect(patch).toMatchObject({
      status: 'drafting', tested_structure_hash: null, tested_binding_hash: null,
      rehearsal_report: null, expires_at: null,
    });
  });
});

describe('the builder never direct-saves a body (design D3)', () => {
  it('AutomationBuilder.tsx contains no updateDefinition call', () => {
    const src = readFileSync(new URL('../src/Function/automation/AutomationBuilder.tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('updateDefinition');
    // Its body writes go through the draft revision seam instead.
    expect(src).toContain('reviseDraftBody');
  });
});
