import { describe, expect, it } from 'vitest';
import { dependencyConflicts as webConflicts, DEPENDENCY_KINDS } from '@/Function/shared/objectDependencyModel';
import { LABEL_PALETTE } from '@/Function/shared/labelColor';
import { parseItemIcon } from '@/Function/shared/itemIcon/itemIconValue';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const board = await import(new URL('../../supabase/functions/_shared/boardTools.ts', import.meta.url).pathname);
const deps = await import(new URL('../../supabase/functions/_shared/dependencyTools.ts', import.meta.url).pathname);
const guide = await import(new URL('../../supabase/functions/_shared/claywareGuide.ts', import.meta.url).pathname);
const catalog = await import(new URL('../../supabase/functions/_shared/catalog.ts', import.meta.url).pathname);
const { runBatchTool } = await import(new URL('../../supabase/functions/_shared/batchTools.ts', import.meta.url).pathname);

describe('dates the AI writes', () => {
  it('takes calendar days and null, and refuses anything else', () => {
    expect(board.dateFieldsError({ start_date: '2026-11-03', due_date: null }, ['start_date', 'due_date'])).toBeNull();
    expect(board.dateFieldsError({ start_date: '2026-02-30' }, ['start_date'])).toMatch(/start_date/);
    expect(board.dateFieldsError({ due_date: '11/26/2026' }, ['due_date'])).toMatch(/due_date/);
  });

  it('refuses a start after its due day', () => {
    expect(board.spanError('2026-11-27', '2026-11-26')).toMatch(/start_date/);
    expect(board.spanError('2026-11-26', '2026-11-26')).toBeNull();
    expect(board.spanError('2026-11-26', null)).toBeNull();
  });

  it('refuses a bad day in one row of createElements without writing any', async () => {
    const db = { from: () => { throw new Error('nothing should be written'); } };
    const result = await runBatchTool(db as never, {
      objectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      elements: [{ title: 'A', start_date: '2026-11-03', due_date: '2026-11-06' }, { title: 'B', start_date: '2026-12-01', due_date: '2026-11-01' }],
    }, { agent: 't', userId: null });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/elements\[1\]/);
  });
});

describe('an Object\'s look and span', () => {
  it('reads every field into the objects row, the lead as lead_id', () => {
    const r = board.objectPatch({ start_date: '2026-11-09', due_date: '2026-11-27', icon: 'glyph:Box', color: 'teal', type: 'Project', leadWorkerId: 'w1' });
    expect(r).toEqual({ ok: true, patch: { start_date: '2026-11-09', due_date: '2026-11-27', icon: 'glyph:Box', color: 'teal', type: 'Project', lead_id: 'w1' } });
    expect(board.objectPatch({ icon: null, color: null })).toEqual({ ok: true, patch: { icon: null, color: null } });
  });

  it('refuses what the app cannot draw', () => {
    expect(board.objectPatch({ icon: 'box' })).toMatchObject({ ok: false });
    expect(board.objectPatch({ color: 'blue' })).toMatchObject({ ok: false });
    expect(board.objectPatch({ start_date: '2026-12-01', due_date: '2026-11-01' })).toMatchObject({ ok: false });
  });

  it('accepts exactly the icons and colours the app reads back', () => {
    for (const icon of ['glyph:Box', 'lucide:shopping-cart', '🏪']) {
      expect(board.iconError(icon)).toBeNull();
      expect(parseItemIcon(icon)).not.toBeNull();
    }
    for (const icon of ['glyph:box', 'lucide:Cart', 'Box']) {
      expect(board.iconError(icon)).not.toBeNull();
      expect(parseItemIcon(icon)).toBeNull();
    }
    expect([...board.PALETTE_KEYS]).toEqual(LABEL_PALETTE.map((p) => p.key));
  });
});

describe('dependencies', () => {
  it('reads the same kinds as the app, fs by default', () => {
    expect([...deps.DEPENDENCY_KINDS]).toEqual([...DEPENDENCY_KINDS]);
    expect(deps.dependencyKindOf(undefined)).toBe('fs');
    expect(deps.dependencyKindOf('ss')).toBe('ss');
    expect(deps.dependencyKindOf('xx')).toBeNull();
  });

  it('flags a conflict exactly where the Timeline draws one red', () => {
    const spans = [
      { start: '2026-11-09', due: '2026-11-27' },
      { start: '2026-11-23', due: '2026-12-09' },
      { start: '2026-11-28', due: '2026-12-09' },
      { start: '2026-11-27', due: '2026-11-27' },
      { start: null, due: '2026-11-20' },
    ];
    for (const kind of DEPENDENCY_KINDS) {
      for (const a of spans) for (const b of spans) {
        expect(deps.dependencyConflicts(kind, a, b)).toBe(webConflicts(kind, a, b));
      }
    }
  });

  it('finds a loop down the chain, and none where there is not one', async () => {
    // c waits for b, b waits for a.
    const waitsFor: Record<string, string[]> = { c: ['b'], b: ['a'] };
    const blockersOf = async (ids: string[]) => ids.flatMap((id) => waitsFor[id] ?? []);
    expect(await deps.dependencyWouldLoop('c', 'a', blockersOf)).toBe(true);  // a waiting for c closes a → c → b → a
    expect(await deps.dependencyWouldLoop('a', 'c', blockersOf)).toBe(false);
    expect(await deps.dependencyWouldLoop('a', 'a', blockersOf)).toBe(true);
  });

  it('is offered with the right effect, and reaches the dependency runner', () => {
    expect(catalog.catalogTool('listDependencies')).toMatchObject({ area: 'execution', effect: 'read' });
    expect(catalog.catalogTool('addDependency')).toMatchObject({ area: 'execution', effect: 'write' });
    expect(catalog.catalogTool('removeDependency')).toMatchObject({ area: 'execution', effect: 'delete' });
    expect(catalog.catalogTool('setLabelColor')).toMatchObject({ area: 'execution', effect: 'write' });
  });
});

describe('a person\'s verb filed already closed', () => {
  it('is caught in createElement and in any row of createElements', () => {
    expect(guide.createdClosedHuman('createElement', { title: '機種を決める', action: 'decide', status: 'done' })).toEqual({ title: '機種を決める', action: 'decide' });
    expect(guide.createdClosedHuman('createElements', { elements: [{ title: 'A', status: 'done' }, { title: 'B', action: 'approve', status: 'review' }] }))
      .toEqual({ title: 'B', action: 'approve' });
  });

  it('lets an open one, or a closed one an AI can do, through', () => {
    expect(guide.createdClosedHuman('createElement', { title: 'A', action: 'decide', status: 'todo' })).toBeNull();
    expect(guide.createdClosedHuman('createElements', { elements: [{ title: 'A', action: 'research', status: 'done' }] })).toBeNull();
  });

  it('is refused before anything is read', async () => {
    const db = { from: () => { throw new Error('no read expected'); } };
    expect(await guide.steerRefusal(db as never, 'createElements', { elements: [{ title: '機種を決める', action: 'decide', status: 'done' }] }))
      .toContain('機種を決める');
  });
});
