import { describe, expect, it } from 'vitest';
import { diffWorkspace, fileFromRow, mergeFolders, rowFromFile, sameStamp } from '@/ActivitySpace/sustainment/slides/sync';
import type { KataFile } from '@/ActivitySpace/sustainment/slides/kata/model/types';

const file = (id: string, name = id): KataFile => ({
  id, name, folderId: 'f1',
  deck: { title: name, storyline: 'scr', slides: [] },
  mix: { selected: [], pins: {}, offset: 0 }, chat: [], updatedAt: 1,
});

describe('Slides ⇄ the Space', () => {
  it('writes only what changed: new, edited, renamed, reordered, removed', () => {
    const a = file('a'); const b = file('b'); const c = file('c');
    const prev = { folders: [{ id: 'f1', name: 'One', open: true }, { id: 'f2', name: 'Two', open: false }], files: [a, b, c] };
    const edited = { ...b, name: 'B2' };
    const d = file('d');
    const next = { folders: [{ id: 'f2', name: 'Two', open: true }, { id: 'f1', name: 'One', open: false }], files: [a, edited, d] };
    const diff = diffWorkspace(prev, next);
    expect(diff.upsertFiles.map((f) => f.id)).toEqual(['b', 'd']);
    expect(diff.deleteFiles).toEqual(['c']);
    // Order changed, so both folders get their new position; open/closed alone is not a change.
    expect(diff.upsertFolders.map(({ f, i }) => [f.id, i])).toEqual([['f2', 0], ['f1', 1]]);
    expect(diff.deleteFolders).toEqual([]);
    expect(diffWorkspace(next, { ...next, folders: next.folders.map((f) => ({ ...f, open: !f.open })) }).upsertFolders).toEqual([]);
  });

  it('round-trips a deck through its row', () => {
    const f = { ...file('a', 'Plan'), chat: [{ id: 'm', from: 'me' as const, text: 'hi', at: 1 }] };
    const row = rowFromFile(f, 'space');
    expect(row).toMatchObject({ id: 'a', activity_space_id: 'space', folder_id: 'f1', name: 'Plan' });
    const back = fileFromRow({ ...row, folder_id: row.folder_id, updated_at: '2026-10-25T00:00:00Z' });
    expect(back.deck).toEqual(f.deck);
    expect(back.chat).toEqual(f.chat);
    // A row from an older writer without every mix field still gives a complete mix.
    expect(fileFromRow({ ...row, mix: { selected: ['forest'] } as never, updated_at: 'x' }).mix).toEqual({ selected: ['forest'], pins: {}, offset: 0 });
  });

  it('merges the Space\'s folders with the ones made or deleted here and not yet written', () => {
    const f = (id: string, open = true) => ({ id, name: id, open });
    const synced = [f('a'), f('b')];
    // Here: "a" closed, "b" deleted (not yet written), "n" new (not yet written).
    const local = [f('a', false), f('n')];
    // The Space now: a, b, and "r" someone else added.
    const remote = [f('a'), f('b'), f('r')];
    expect(mergeFolders(remote, local, synced)).toEqual([f('a', false), f('r'), f('n')]);
    // A folder someone else deleted goes, and nothing is invented.
    expect(mergeFolders([f('b')], [f('a'), f('b')], synced)).toEqual([f('b')]);
  });

  it('reads a Realtime timestamp and a Postgres one as the same moment', () => {
    expect(sameStamp('2026-10-25T03:00:58.123456+00:00', '2026-10-25 03:00:58.123456+00')).toBe(true);
    expect(sameStamp('2026-10-25T03:00:58.123456Z', '2026-10-25T03:00:58.123456')).toBe(true);
    expect(sameStamp('2026-10-25T03:00:58.123456+00:00', '2026-10-25T03:00:58.123457+00:00')).toBe(false);
    expect(sameStamp(undefined, '2026-10-25T03:00:58Z')).toBe(false);
  });
});
