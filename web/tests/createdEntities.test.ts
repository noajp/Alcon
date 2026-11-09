import { describe, expect, it } from 'vitest';

// The created record's server half: the extractor that reads a create
// family's result into card records (createdEntities.ts) and the step
// detail builder that carries them to the live panel within the
// detail's size limit (copilotSession.ts). Both pure.
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const { createdOf } = await import(new URL('../../supabase/functions/_shared/createdEntities.ts', import.meta.url).pathname);
const session = await import(new URL('../../supabase/functions/_shared/copilotSession.ts', import.meta.url).pathname);
const { toolStepDetail, TOOL_STEP_CREATED_CAP, TOOL_STEP_DETAIL_LIMIT } = session;

describe('createdOf', () => {
  it('reads a created Element row (createElement)', () => {
    expect(createdOf('createElement', {
      id: 'e1', display_id: 'ELE_OBJ-001', seq_number: 1, title: '調査する', status: 'todo', priority: 'medium', object_id: 'o1',
    })).toEqual([
      { kind: 'element', id: 'e1', title: '調査する', displayId: 'ELE_OBJ-001', status: 'todo', objectId: 'o1' },
    ]);
  });

  it('reads a created Sub-element row — no Object on its result, none claimed', () => {
    expect(createdOf('createSubelement', {
      id: 'e2', display_id: 'ELE_OBJ-002', seq_number: 2, title: '子タスク', status: 'todo', parent_id: 'e1',
    })).toEqual([
      { kind: 'element', id: 'e2', title: '子タスク', displayId: 'ELE_OBJ-002', status: 'todo' },
    ]);
  });

  it('maps a batch result’s created rows (createElements)', () => {
    expect(createdOf('createElements', {
      created: [
        { id: 'e1', display_id: 'ELE_OBJ-001', title: 'A', status: 'todo', priority: 'high' },
        { id: 'e2', display_id: 'ELE_OBJ-002', title: 'B', status: 'done', priority: null },
      ],
    })).toEqual([
      { kind: 'element', id: 'e1', title: 'A', displayId: 'ELE_OBJ-001', status: 'todo' },
      { kind: 'element', id: 'e2', title: 'B', displayId: 'ELE_OBJ-002', status: 'done' },
    ]);
  });

  it('a row missing display_id still yields a card record', () => {
    expect(createdOf('createElements', { created: [{ id: 'e9', title: '番号なし', status: 'todo' }] }))
      .toEqual([{ kind: 'element', id: 'e9', title: '番号なし', status: 'todo' }]);
  });

  it('reads a created Object row — its name is the title', () => {
    expect(createdOf('createObject', { id: 'o1', name: '請求対応', prefix: 'CLM', domain_id: 'd1' }))
      .toEqual([{ kind: 'object', id: 'o1', title: '請求対応' }]);
  });

  it('reads a created Strategy row (createInitiative, top-level and Sub)', () => {
    expect(createdOf('createInitiative', { id: 's1', name: '競合調査', parentIds: [] }))
      .toEqual([{ kind: 'strategy', id: 's1', title: '競合調査' }]);
    expect(createdOf('createInitiative', { id: 's2', name: '価格調査' }))
      .toEqual([{ kind: 'strategy', id: 's2', title: '価格調査' }]);
  });

  it('yields undefined for non-create tools, whatever their result looks like', () => {
    expect(createdOf('updateElement', { id: 'e1', title: '直した', status: 'done' })).toBeUndefined();
    expect(createdOf('listElements', [{ id: 'e1', title: 'A' }])).toBeUndefined();
    expect(createdOf('deleteElement', { id: 'e1', deleted: true })).toBeUndefined();
  });

  it('yields undefined for malformed create results', () => {
    expect(createdOf('createElement', null)).toBeUndefined();
    expect(createdOf('createElement', { title: 'id なし' })).toBeUndefined();
    expect(createdOf('createElement', { id: 'e1' })).toBeUndefined();
    expect(createdOf('createElement', { id: 'e1', title: '  ' })).toBeUndefined();
    expect(createdOf('createElements', { created: 'not-an-array' })).toBeUndefined();
    expect(createdOf('createElements', { created: [] })).toBeUndefined();
    expect(createdOf('createElements', {})).toBeUndefined();
    expect(createdOf('createObject', { id: 'o1' })).toBeUndefined();
    expect(createdOf('createInitiative', { name: 'id なし' })).toBeUndefined();
  });

  it('keeps the valid rows of a batch and drops the malformed ones', () => {
    expect(createdOf('createElements', {
      created: [{ id: 'e1', title: 'A' }, { title: 'id なし' }, null, { id: 'e2', title: 'B' }],
    })).toEqual([
      { kind: 'element', id: 'e1', title: 'A' },
      { kind: 'element', id: 'e2', title: 'B' },
    ]);
  });
});

describe('toolStepDetail', () => {
  const batch = (n: number) => Array.from({ length: n }, (_, i) => ({
    kind: 'element' as const, id: `e${i}`, title: `要素 ${i}`, displayId: `ELE_OBJ-${String(i + 1).padStart(3, '0')}`, status: 'todo',
  }));

  it('carries input and outcome as before when nothing was created', () => {
    expect(JSON.parse(toolStepDetail({ input: { status: 'todo' }, rows: 12 })))
      .toEqual({ input: { status: 'todo' }, rows: 12 });
    expect(JSON.parse(toolStepDetail({ error: 'Element not found' })))
      .toEqual({ error: 'Element not found' });
  });

  it('carries the created records whole under the cap', () => {
    const detail = JSON.parse(toolStepDetail({ input: { objectId: 'o1' }, rows: 2, created: batch(2) }));
    expect(detail.created).toEqual(batch(2));
    expect(detail.createdTotal).toBeUndefined();
    expect(detail.rows).toBe(2);
  });

  it('caps the detail’s created list and keeps the total count', () => {
    const created = batch(TOOL_STEP_CREATED_CAP + 3);
    const detail = JSON.parse(toolStepDetail({ rows: created.length, created }));
    expect(detail.created).toEqual(created.slice(0, TOOL_STEP_CREATED_CAP));
    expect(detail.createdTotal).toBe(created.length);
  });

  it('an oversized input is what gives: the JSON stays whole and the created records survive', () => {
    const created = batch(50);
    const raw = toolStepDetail({ input: { note: 'x'.repeat(9000) }, rows: 50, created });
    expect(raw.length).toBeLessThanOrEqual(TOOL_STEP_DETAIL_LIMIT);
    const detail = JSON.parse(raw);
    expect(detail.input).toBeUndefined();
    expect(detail.created).toEqual(created.slice(0, TOOL_STEP_CREATED_CAP));
    expect(detail.createdTotal).toBe(50);
    expect(detail.rows).toBe(50);
  });
});
