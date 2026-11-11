import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const catalog = await import(new URL('../../supabase/functions/_shared/catalog.ts', import.meta.url).pathname);
const files = await import(new URL('../../supabase/functions/_shared/fileTools.ts', import.meta.url).pathname);
const harness = await import(new URL('../../supabase/functions/_shared/harnessTools.ts', import.meta.url).pathname);
const conversation = await import(new URL('../../supabase/functions/run-agent/conversation.ts', import.meta.url).pathname);
const agentTools = await import(new URL('../../supabase/functions/run-agent/agentTools.ts', import.meta.url).pathname);

type T = { name: string; defer?: boolean; effect: string; area: string };
const names = (tools: T[]) => tools.map((t) => t.name);
const ENTRIES = ['panel', 'conversation', 'element'] as const;

describe('the tool catalog', () => {
  it('names every tool once', () => {
    const all = names(catalog.CATALOG);
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives every entry what a cross-entry job needs: read a file, read and create a Strategy', () => {
    for (const entry of ENTRIES) {
      const offered = names(catalog.toolsFor(entry));
      expect(offered, entry).toEqual(expect.arrayContaining(['readFile', 'listFiles', 'listInitiatives', 'getInitiative', 'createInitiative', 'readHarness']));
    }
  });

  it('keeps each entry inside its permission', () => {
    const offered = (entry: string) => catalog.toolsFor(entry) as T[];
    // Tools that only delete are never offered where deletes are not allowed.
    expect(offered('element').some((t) => t.effect === 'delete')).toBe(false);
    expect(offered('conversation').filter((t) => t.effect === 'delete').map((t) => t.name)).toEqual(['removeIntent']);
    expect(names(offered('panel'))).toEqual(expect.arrayContaining(['deleteInitiative', 'deleteElement', 'widgetBoard']));
  });

  it('decides each call of a multi-action tool by its action', () => {
    const tool = (n: string) => catalog.catalogTool(n);
    expect(catalog.effectOfCall(tool('widgetBoard'), { action: 'list' })).toBe('read');
    expect(catalog.effectOfCall(tool('widgetBoard'), { action: 'update' })).toBe('write');
    expect(catalog.effectOfCall(tool('widgetBoard'), { action: 'delete' })).toBe('delete');
    expect(catalog.effectOfCall(tool('campaignMeasure'), { action: 'campaigns' })).toBe('read');
    // An action nobody knows counts as the most dangerous one.
    expect(catalog.effectOfCall(tool('widgetBoard'), { action: 'purge' })).toBe('delete');
    expect(catalog.effectOfCall(tool('createElement'), { action: 'delete' })).toBe('write');
  });

  it('lets an Element run work, asks before it changes a Strategy, and never lets it delete', () => {
    const d = (n: string, input: Record<string, unknown> = {}) => catalog.decideCall('element', catalog.catalogTool(n), input);
    expect(d('createElement')).toBe('allow');
    expect(d('writeFile')).toBe('allow');
    expect(d('readFile')).toBe('allow');
    for (const n of ['createInitiative', 'updateInitiative', 'addIntent', 'updateIntent', 'writeInitiativeDefinition']) expect(d(n), n).toBe('approve');
    expect(d('campaignMeasure', { action: 'update' })).toBe('approve');
    expect(d('campaignMeasure', { action: 'list' })).toBe('allow');
    for (const n of ['deleteElement', 'deleteObject', 'bulkDeleteElements', 'removeIntent', 'deleteInitiative']) expect(d(n), n).toBe('deny');
    expect(d('campaignMeasure', { action: 'delete' })).toBe('deny');
    expect(d('widgetBoard', { action: 'update' })).toBe('deny');
    expect(catalog.mayNeedApproval('element', 'addIntent')).toBe(true);
    expect(catalog.mayNeedApproval('element', 'createElement')).toBe(false);
    expect(catalog.mayNeedApproval('panel', 'addIntent')).toBe(false);
  });

  it('lets a conversation write the Strategy\'s record and files, nothing else', () => {
    const d = (n: string, input: Record<string, unknown> = {}) => catalog.decideCall('conversation', catalog.catalogTool(n), input);
    for (const n of ['addIntent', 'updateInitiative', 'createInitiative', 'writeInitiativeDefinition', 'removeIntent', 'writeFile']) expect(d(n), n).toBe('allow');
    for (const n of ['createElement', 'updateElement', 'deleteInitiative', 'createElements']) expect(d(n), n).toBe('deny');
    expect(d('campaignMeasure', { action: 'delete' })).toBe('deny');
  });

  it('lets the panel run everything the person can', () => {
    for (const t of catalog.CATALOG) expect(catalog.decideCall('panel', t, { action: 'delete' }), t.name).toBe('allow');
  });

  it('loads each entry\'s core up front and defers the rest, core first', () => {
    for (const entry of ENTRIES) {
      const tools = catalog.toolsFor(entry) as T[];
      const core: string[] = catalog.ENTRY_POLICIES[entry].core;
      // Every core tool is one the entry may use.
      expect(names(tools.filter((t) => !t.defer)).sort(), entry).toEqual([...core].sort());
      const firstDeferred = tools.findIndex((t) => t.defer);
      expect(tools.slice(firstDeferred).every((t) => t.defer)).toBe(true);
    }
  });

  it('lists the deferred tools by name and one line, grouped by area', () => {
    const tools = catalog.toolsFor('panel');
    const index: string = catalog.catalogIndex(tools);
    expect(index).toContain('- deleteInitiative: ');
    expect(index).not.toContain('- listFiles: '); // loaded already
    expect(catalog.catalogIndex(tools.filter((t: T) => !t.defer))).toBe('');
    expect(catalog.summaryOf('一つ目の文。二つ目の文。')).toBe('一つ目の文。');
  });

  it('runs the same tools in a conversation and an Element\'s run as in the panel', () => {
    expect(names(conversation.conversationTools())).toEqual(expect.arrayContaining(names(catalog.toolsFor('conversation'))));
    expect(agentTools.baseKindOf('createInitiative')).toBe('board');
    expect(agentTools.baseKindOf('readFile')).toBe('board');
  });

  it('refuses a tool it does not have', async () => {
    const r = await catalog.runCatalogTool({} as never, 'dropDatabase', {}, { agent: 'x', userId: null }, { entry: 'panel' });
    expect(r).toMatchObject({ ok: false });
  });

  it('refuses at run time what the entry may not run, before touching the database', async () => {
    const db = { from: () => { throw new Error('the database was reached'); } };
    const denied = await catalog.runCatalogTool(db as never, 'deleteElement', { elementId: 'x' }, { agent: 'x', userId: null }, { entry: 'element' });
    expect(denied).toMatchObject({ ok: false });
    expect(denied.error).toContain('ここからは実行できません');
    const waiting = await catalog.runCatalogTool(db as never, 'addIntent', { initiativeId: 'x', kind: 'decision', title: 't' }, { agent: 'x', userId: null }, { entry: 'element' });
    expect(waiting).toMatchObject({ ok: false });
    expect(waiting.error).toContain('承認');
  });

  it('routes a Strategy delete to strategies only', async () => {
    const tables: string[] = [];
    const chain = { eq: () => chain, select: async () => ({ data: [{ id: 'x' }], error: null }) };
    const db = { from: (t: string) => { tables.push(t); return { delete: () => chain }; } };
    const r = await catalog.runCatalogTool(db as never, 'deleteInitiative', { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, { agent: 'x', userId: null }, { entry: 'panel' });
    expect(r.ok).toBe(true);
    expect(tables).toEqual(['strategies']);
  });
});

describe('file tools', () => {
  it('names an owner by kind and UUID', () => {
    expect(files.fileOwnerOf({ ownerKind: 'strategy', ownerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })).toEqual({ kind: 'strategy', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(files.fileOwnerOf({ ownerKind: 'space', ownerId: 'x' })).toHaveProperty('error');
    expect(files.fileOwnerOf({ ownerKind: 'element', ownerId: 'ELE-1' })).toHaveProperty('error');
  });

  it('writes text formats only, under a safe name', () => {
    expect(files.textFileName('notes/2026:11.md')).toEqual({ name: 'notes 2026 11.md', mime: 'text/markdown' });
    expect(files.textFileName('report')).toHaveProperty('error');
    expect(files.textFileName('app.exe')).toHaveProperty('error');
  });

  it('reads text files as they are and others through their extracted text', () => {
    expect(files.isTextFile('Untitled.txt', null)).toBe(true);
    expect(files.isTextFile('data', 'application/json')).toBe(true);
    expect(files.isTextFile('deck.pdf', 'application/pdf')).toBe(false);
  });

  it('pages a long text', () => {
    const text = 'a'.repeat(25);
    expect(files.pageOf(text, 0, 10)).toEqual({ text: 'a'.repeat(10), nextOffset: 10, total: 25 });
    expect(files.pageOf(text, 20, 10)).toEqual({ text: 'a'.repeat(5), nextOffset: null, total: 25 });
  });

  it('lists only the newest version of each file', () => {
    const rows = [{ id: 'v1', previous_id: null }, { id: 'v2', previous_id: 'v1' }, { id: 'other', previous_id: null }];
    expect(files.latestOnly(rows).map((r: { id: string }) => r.id)).toEqual(['v2', 'other']);
  });
});

describe('harness tools', () => {
  it('lists a harness by its goal\'s first line', () => {
    expect(harness.harnessSummary('# 目的\n- 問い合わせを分類して担当に渡す\n- 二行目\n\n# 進め方\n...')).toBe('問い合わせを分類して担当に渡す');
    expect(harness.harnessSummary('# 進め方\n手順だけ')).toBe('');
  });
});
