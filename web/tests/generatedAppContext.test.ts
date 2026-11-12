import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { from: mock.from, auth: { getUser: mock.getUser } } }));
import { readGeneratedAppContext } from '../src/hooks/generatedAppContext';
import { summaryApp } from '../src/Function/widget/generated/summaryApp';
import { CANVAS_TEMPLATES } from '../src/Function/widget/generated/templates';
import { parseAppSource } from '../src/Function/widget/generated/model';
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failTable: string | null;
beforeEach(() => {
  failTable = null;
  tables = {
    objects: [{ id: 'object', name: 'A', domain_id: 'domain', phase_id: null }],
    elements: [{ id: 'a', object_id: 'object', title: 'Primary' }, { id: 'b', object_id: 'other', title: 'Multi-home' }, { id: 'c', object_id: 'other', title: 'Unrelated' }],
    element_objects: [{ object_id: 'object', element_id: 'a' }, { object_id: 'object', element_id: 'b' }],
    strategy_objects: [{ object_id: 'object', strategy_id: 'strategy' }],
    strategies: [{ id: 'strategy', name: 'Purpose' }, { id: 'unrelated', name: 'Unrelated' }],
    intents: [{ id: 'intent', strategy_id: 'strategy', title: 'Outcome', actual_value: null, superseded_by_intent_id: 'new' }],
    intent_bindings: [{ id: 'binding', intent_id: 'intent', target_id: 'object', target_type: 'object', relationship_type: 'delivers' }],
    object_domains: [], domains: [{ id: 'domain', name: 'Domain' }], phases: [],
  };
  mock.getUser.mockReset().mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  mock.from.mockReset().mockImplementation((table: string) => {
    const filters: [string, unknown][] = [];
    let single = false; let offset = 0;
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (key: string, value: unknown[]) => { filters.push([key, value]); return query; },
      order: () => query, range: (from: number) => { offset = from; return query; },
      single: () => { single = true; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = (tables[table] ?? []).filter(r => filters.every(([key, value]) => Array.isArray(value) ? value.includes(r[key]) : r[key] === value));
        return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows.slice(offset, offset + 1), count: rows.length, error: table === failTable ? { message: 'denied' } : null }));
      },
    };
    return query;
  });
});
describe('generated app scoped data', () => {
  it('reads every page of primary and multi-home Elements once and only related Strategy', async () => {
    const snapshot = await readGeneratedAppContext('object', 'user');
    expect(snapshot.elements.map(e => e.id)).toEqual(['a', 'b']);
    expect(snapshot.initiatives.map(i => i.id)).toEqual(['strategy']);
    expect(snapshot.intents[0].actual_value).toBeNull();
    expect(snapshot.intents[0].superseded_by_intent_id).toBe('new');
    expect(snapshot.domains.map(d => d.id)).toEqual(['domain']);
    expect(snapshot.bindings[0].intent_id).toBe('intent');
    expect(snapshot.object).not.toHaveProperty('domain_id');
  });
  it('fails before any data read when auth changes', async () => {
    await expect(readGeneratedAppContext('object', 'other-user')).rejects.toThrow('Sign in');
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('discards an in-flight snapshot when the user switches', async () => {
    mock.getUser.mockResolvedValueOnce({ data: { user: { id: 'user' } }, error: null }).mockResolvedValue({ data: { user: { id: 'other' } }, error: null });
    await expect(readGeneratedAppContext('object', 'user')).rejects.toThrow('Sign in');
  });
  it('fails closed on denial or failed related reads instead of reporting false zero totals', async () => {
    tables.objects = [];
    await expect(readGeneratedAppContext('object', 'user')).rejects.toThrow('access denied');
    tables.objects = [{ id: 'object' }]; failTable = 'intents';
    await expect(readGeneratedAppContext('object', 'user')).rejects.toThrow('denied');
  });
  it('keeps executable summary source and an explicit data capability', () => {
    expect(parseAppSource(summaryApp).usesObjectData).toBe(true);
    expect(() => new (Object.getPrototypeOf(async function() {}).constructor)(summaryApp.js)).not.toThrow();
    expect(() => parseAppSource({ ...summaryApp, usesObjectData: 'yes' })).toThrow();
    expect(parseAppSource({ ...summaryApp, usesObjectData: undefined }).usesObjectData).toBeUndefined();
  });

  it('every built-in canvas is a valid app whose code compiles', () => {
    for (const tpl of CANVAS_TEMPLATES) {
      expect(() => parseAppSource(tpl.source), tpl.id).not.toThrow();
      expect(() => new (Object.getPrototypeOf(async function() {}).constructor)(tpl.source.js), tpl.id).not.toThrow();
    }
  });
});
