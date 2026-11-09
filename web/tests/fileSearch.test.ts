import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const files = await import(new URL('../../supabase/functions/_shared/fileTools.ts', import.meta.url).pathname);
const catalog = await import(new URL('../../supabase/functions/_shared/catalog.ts', import.meta.url).pathname);

type Row = Record<string, unknown>;

/** One search_attachments row: a PDF on an Element with an unrelated title —
 *  the episode this tool exists for. */
const hitRow = (over: Row = {}): Row => ({
  id: 'file-1',
  name: 'CCDV-F 模試1回目 復習ノート.pdf',
  mime_type: 'application/pdf',
  element_id: 'el-1',
  object_id: null,
  strategy_id: null,
  folder_id: null,
  owner_label: '再描画が広く伝わる',
  element_object_id: 'ob-1',
  domain_id: 'do-1',
  snippet: null,
  ...over,
});

describe('searchFiles shaping (the RPC rows become host-context results)', () => {
  it('carries the host with the file: kind, label, the Element\'s Object and Domain', () => {
    const hit = files.searchHitOf(hitRow(), '復習');
    expect(hit).toEqual({
      id: 'file-1',
      name: 'CCDV-F 模試1回目 復習ノート.pdf',
      mime_type: 'application/pdf',
      host: { kind: 'element', label: '再描画が広く伝わる' },
      element_object_id: 'ob-1',
      domain_id: 'do-1',
      snippet: null,
      matched: 'name',
    });
  });

  it('derives what matched in the RPC\'s precedence: name, then contents, then the host', () => {
    // The name ranks first, even when the text also matched.
    expect(files.searchMatchedOf(hitRow({ snippet: '…復習…' }), '復習')).toBe('name');
    // A snippet exists only where the extracted text matched.
    expect(files.searchMatchedOf(hitRow({ name: 'review.pdf', snippet: '…正答率 57%…' }), '57%')).toBe('contents');
    // Neither name nor text: the host's name is what matched.
    expect(files.searchMatchedOf(hitRow({ name: 'x.pdf', owner_label: '請求書の整理' }), '請求書')).toBe('owner');
  });

  it('names the host kind from whichever owner column is set', () => {
    const base = { element_id: null, object_id: null, strategy_id: null, folder_id: null };
    expect(files.searchHostOf(hitRow({ ...base, object_id: 'o' }))?.kind).toBe('object');
    expect(files.searchHostOf(hitRow({ ...base, strategy_id: 's' }))?.kind).toBe('strategy');
    expect(files.searchHostOf(hitRow({ ...base, folder_id: 'f' }))?.kind).toBe('folder');
    expect(files.searchHostOf(hitRow({ ...base }))).toBeNull();
  });

  it('merges several Spaces newest-first and caps at the limit', () => {
    const hit = (id: string) => files.searchHitOf(hitRow({ id, name: `${id}.pdf` }), 'pdf');
    const merged = files.mergeSearchHits([
      [{ hit: hit('a'), createdAt: '2026-11-01T00:00:00Z' }],
      [{ hit: hit('b'), createdAt: '2026-11-03T00:00:00Z' }, { hit: hit('c'), createdAt: '2026-11-02T00:00:00Z' }],
    ], 10);
    expect(merged.map((h: { id: string }) => h.id)).toEqual(['b', 'c', 'a']);
    expect(files.mergeSearchHits([[{ hit: hit('a'), createdAt: '2026-11-01T00:00:00Z' }, { hit: hit('b'), createdAt: '2026-11-03T00:00:00Z' }]], 1).map((h: { id: string }) => h.id)).toEqual(['b']);
  });
});

describe('searchFiles through runFileTool (a stubbed db)', () => {
  it('searches the ambient Space only, with the NFKC-normalised query', async () => {
    const calls: { fn: string; args: Row }[] = [];
    const db = {
      rpc: async (fn: string, args: Row) => {
        calls.push({ fn, args });
        return { data: [hitRow()], error: null };
      },
      from: () => { throw new Error('no table is read when the Space is ambient'); },
    };
    const r = await files.runFileTool(db as never, 'searchFiles', { query: 'ＣＣＤＶ' }, { spaceId: 'space-1' });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ fn: 'search_attachments', args: { p_space: 'space-1', p_query: 'CCDV', p_limit: 20 } }]);
    expect(r.data[0]).toMatchObject({ id: 'file-1', matched: 'name', host: { kind: 'element', label: '再描画が広く伝わる' } });
  });

  it('refuses an empty query', async () => {
    const r = await files.runFileTool({} as never, 'searchFiles', { query: '  ' }, { spaceId: 'space-1' });
    expect(r.ok).toBe(false);
  });

  it('without an ambient Space, searches the caller\'s Spaces and merges newest-first', async () => {
    const rowsBySpace: Record<string, Row[]> = {
      s1: [hitRow({ id: 'old', name: '古い.pdf' })],
      s2: [hitRow({ id: 'new', name: '新しい.pdf' })],
    };
    const stamps = [
      { id: 'old', created_at: '2026-11-01T00:00:00Z' },
      { id: 'new', created_at: '2026-11-05T00:00:00Z' },
    ];
    const db = {
      rpc: async (_fn: string, args: Row) => ({ data: rowsBySpace[String(args.p_space)] ?? [], error: null }),
      from: (t: string) => ({
        select: () => (t === 'activity_spaces'
          ? Promise.resolve({ data: [{ id: 's1' }, { id: 's2' }], error: null })
          : { in: async () => ({ data: stamps, error: null }) }),
      }),
    };
    const r = await files.runFileTool(db as never, 'searchFiles', { query: 'pdf' }, {});
    expect(r.ok).toBe(true);
    expect(r.data.map((h: { id: string }) => h.id)).toEqual(['new', 'old']);
    const capped = await files.runFileTool(db as never, 'searchFiles', { query: 'pdf', limit: 1 }, {});
    expect(capped.data.map((h: { id: string }) => h.id)).toEqual(['new']);
  });

  it('answers empty when the caller belongs to no Space', async () => {
    const db = { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) };
    const r = await files.runFileTool(db as never, 'searchFiles', { query: 'pdf' }, {});
    expect(r).toMatchObject({ ok: true, data: [] });
  });
});

describe('readFile states its no-text states honestly', () => {
  const FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const readDb = (textRow: unknown) => ({
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => (t === 'attachments'
            ? { data: { id: FILE_ID, name: 'note.pdf', mime_type: 'application/pdf', path: 'element/el-1/note.pdf', size: 10, deleted_at: null }, error: null }
            : { data: textRow, error: null }),
        }),
      }),
    }),
  });

  it('no extraction row yet: not extracted, and no promise that opening the file extracts it', async () => {
    const r = await files.runFileTool(readDb(null) as never, 'readFile', { id: FILE_ID });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('まだ取り出されていません');
    expect(r.error).not.toContain('アプリで一度開くと');
  });

  it('a row with no text: the file has no readable text — a different state, a different message', async () => {
    const r = await files.runFileTool(readDb({ body: '' }) as never, 'readFile', { id: FILE_ID });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('読み取れる文字が入っていません');
    expect(r.error).not.toContain('まだ取り出されていません');
  });

  it('a row with text reads as before', async () => {
    const r = await files.runFileTool(readDb({ body: '本文テキスト' }) as never, 'readFile', { id: FILE_ID });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ id: FILE_ID, name: 'note.pdf', text: '本文テキスト', nextOffset: null, total: 6 });
  });
});

describe('the catalog registration', () => {
  it('offers searchFiles as a core read in every entry', () => {
    const tool = catalog.catalogTool('searchFiles');
    expect(tool).toMatchObject({ area: 'files', effect: 'read' });
    for (const entry of ['panel', 'conversation', 'element'] as const) {
      const found = (catalog.toolsFor(entry) as { name: string; defer?: boolean }[]).find((t) => t.name === 'searchFiles');
      expect(found, entry).toBeTruthy();
      expect(found?.defer, entry).toBeUndefined();
      expect(catalog.decideCall(entry, tool, {}), entry).toBe('allow');
    }
  });

  it('threads the entry\'s Space through runCatalogTool to the search', async () => {
    const calls: { fn: string; args: Row }[] = [];
    const db = {
      rpc: async (fn: string, args: Row) => {
        calls.push({ fn, args });
        return { data: [hitRow()], error: null };
      },
    };
    const r = await catalog.runCatalogTool(db as never, 'searchFiles', { query: '模試' }, { agent: 'x', userId: null }, { entry: 'panel', spaceId: 'space-9' });
    expect(r.ok).toBe(true);
    expect(calls[0]?.args.p_space).toBe('space-9');
  });
});
