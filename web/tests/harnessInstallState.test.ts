import { describe, expect, it } from 'vitest';
import { catalogRelation, enabledDefinitions, lineDiffCounts } from '@/AIP/harness/installState';
import type { CatalogDefinition } from '@/hooks/customizeData';

const item = (over: Partial<CatalogDefinition> = {}): CatalogDefinition => ({
  id: 'def.x', kind: 'definition', name: 'X', description: '', body: '# 目的\ndo it', sort: 0, version: 2, ...over,
});
const copy = (over: Record<string, unknown> = {}) => ({
  name: 'X', body: '# 目的\ndo it', source_id: 'def.x', source_version: 2, ...over,
});

describe('catalogRelation', () => {
  it('a definition written in the Space is local', () => {
    expect(catalogRelation(copy({ source_id: null, source_version: null }), item())).toEqual({ kind: 'local' });
    expect(catalogRelation(copy({ source_id: null, source_version: null }), null)).toEqual({ kind: 'local' });
  });

  it('a copy whose catalog item is gone is orphaned', () => {
    expect(catalogRelation(copy(), null)).toEqual({ kind: 'orphaned', sourceId: 'def.x' });
  });

  it('a copy with no recorded version is legacy-unknown, never an update', () => {
    expect(catalogRelation(copy({ source_version: null }), item({ version: 9 })))
      .toEqual({ kind: 'legacy-unknown', catalogVersion: 9, differs: false });
    expect(catalogRelation(copy({ source_version: null, body: 'edited' }), item()))
      .toEqual({ kind: 'legacy-unknown', catalogVersion: 2, differs: true });
  });

  it('a copy at the catalog version is current', () => {
    expect(catalogRelation(copy(), item())).toEqual({ kind: 'current', version: 2, differs: false });
  });

  it('an update is claimed only when the catalog version is ahead of the recorded one', () => {
    expect(catalogRelation(copy({ source_version: 1 }), item({ version: 3 })))
      .toEqual({ kind: 'update-available', installedVersion: 1, catalogVersion: 3, differs: false });
    // A newer recorded version than the catalog's (should not happen) is not an update.
    expect(catalogRelation(copy({ source_version: 5 }), item({ version: 3 })).kind).toBe('current');
  });

  it('differs looks at the name and the body, not the description', () => {
    expect(catalogRelation(copy({ name: 'Renamed' }), item())).toMatchObject({ differs: true });
    expect(catalogRelation(copy({ body: 'other' }), item())).toMatchObject({ differs: true });
    expect(catalogRelation(copy(), item({ description: 'a new description' }))).toMatchObject({ differs: false });
  });
});

describe('lineDiffCounts', () => {
  it('identical bodies differ by nothing', () => {
    expect(lineDiffCounts('a\nb\nc', 'a\nb\nc')).toEqual({ removed: 0, added: 0 });
  });

  it('counts appended and removed lines', () => {
    expect(lineDiffCounts('a\nb', 'a\nb\nc\nd')).toEqual({ removed: 0, added: 2 });
    expect(lineDiffCounts('a\nb\nc', 'a')).toEqual({ removed: 2, added: 0 });
    expect(lineDiffCounts('a\nb', 'a\nx')).toEqual({ removed: 1, added: 1 });
  });

  it('a reordered line counts as one removed and one added', () => {
    expect(lineDiffCounts('a\nb\nc', 'b\na\nc')).toEqual({ removed: 1, added: 1 });
  });
});

describe('enabledDefinitions', () => {
  it('keeps the enabled ones, in order', () => {
    const defs = [
      { id: '1', enabled: true }, { id: '2', enabled: false }, { id: '3', enabled: true },
    ];
    expect(enabledDefinitions(defs).map((d) => d.id)).toEqual(['1', '3']);
    expect(enabledDefinitions([])).toEqual([]);
  });
});
