import { describe, expect, it } from 'vitest';

const r = await import(new URL('../../supabase/functions/run-agent/records.ts', import.meta.url).pathname);

const cols = [{ id: 'c1', name: 'URL', type: 'text' }, { id: 'c2', name: '家賃', type: 'number' }];
const rows = [
  { id: 'r1', cells: { URL: 'https://a.example/1', 家賃: 180000 } },
  { id: 'r2', cells: { URL: 'https://a.example/2', 家賃: 200000 } },
];

describe('planUpsert', () => {
  it('adds new things, changes only the cells that differ, and leaves the same alone', () => {
    const plan = r.planUpsert(cols, rows, 'URL', [
      { URL: 'https://a.example/1', 家賃: 180000 },
      { URL: ' https://A.example/2 ', 家賃: 210000 },
      { URL: 'https://a.example/3', 家賃: 150000, 最寄り駅: '三鷹' },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toEqual([{ rowId: 'r2', cells: { 家賃: 210000 } }]);
    expect(plan.inserts).toEqual([{ URL: 'https://a.example/3', 家賃: 150000, 最寄り駅: '三鷹' }]);
    expect(plan.newColumns).toEqual([{ name: '最寄り駅', type: 'text' }]);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a record without its key, and merges two records of one thing', () => {
    const plan = r.planUpsert([], [], '名前', [
      { 名前: '古民家A', 広さ: 140 }, { 広さ: 90 }, { 名前: '古民家a', 駐車場: true }, 'oops',
    ]);
    expect(plan.inserts).toEqual([{ 名前: '古民家A', 広さ: 140, 駐車場: true }]);
    expect(plan.skipped).toHaveLength(2);
    // The key column comes first, so a new Table opens on it.
    expect(plan.newColumns.map((c: { name: string }) => c.name)).toEqual(['名前', '広さ', '駐車場']);
    expect(plan.newColumns.map((c: { type: string }) => c.type)).toEqual(['text', 'number', 'checkbox']);
  });

  it('treats 101 and "101" as the same, and an empty string as clearing', () => {
    const plan = r.planUpsert([{ id: 'k', name: 'ID', type: 'text' }, { id: 'n', name: 'メモ', type: 'text' }],
      [{ id: 'r', cells: { ID: 101, メモ: 'x' } }], 'ID', [{ ID: '101', メモ: '' }]);
    expect(plan.updates).toEqual([{ rowId: 'r', cells: { メモ: null } }]);
    expect(plan.inserts).toEqual([]);
  });
});

describe('inferType', () => {
  it('names a column by the values it is first given', () => {
    expect(r.inferType([1, 2, null])).toBe('number');
    expect(r.inferType(['2026-11-01', null])).toBe('date');
    expect(r.inferType([true, false])).toBe('checkbox');
    expect(r.inferType([1, 'a'])).toBe('text');
    expect(r.inferType([null])).toBe('text');
  });
});

describe('matchRows and notes', () => {
  it('filters by every where value, compared as text', () => {
    const all = [{ 区: '三鷹', 空き: true }, { 区: '武蔵野', 空き: true }, { 区: '三鷹', 空き: false }];
    expect(r.matchRows(all, { 区: '三鷹', 空き: true })).toEqual([{ 区: '三鷹', 空き: true }]);
    expect(r.matchRows(all, undefined)).toHaveLength(3);
  });

  it('says what changed in the Table a finished Element used', () => {
    expect(r.staleNote('候補物件', 3, 0)).toContain('3 行追加');
    expect(r.staleNote('候補物件', 0, 2)).toContain('2 行更新');
    expect(r.staleNote('候補物件', 1, 1)).toContain('1 行追加・1 行更新');
  });
});
