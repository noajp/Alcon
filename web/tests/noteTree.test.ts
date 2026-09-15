import { describe, expect, it } from 'vitest';
import { resolveSectionSelection } from '../src/ActivitySpace/sustainment/notebook/noteTree';
import type { NoteNode } from '../src/types/notes';

const node = (id: string, type: NoteNode['type'], parentId: string | null): NoteNode => ({ id, type, name: id, parentId, linkedObjectId: null });
const nodes: NoteNode[] = [
  node('F', 'folder', null),
  node('A', 'section', 'F'), node('B', 'section', 'F'),
  node('a1', 'file', 'A'), node('x', 'file', 'B'),
  node('loose', 'file', 'F'),
];

describe('resolveSectionSelection', () => {
  it('follows the open file into its Section when nothing is picked', () => {
    expect(resolveSectionSelection(nodes, 'F', null, 'x')).toBe('B');
    expect(resolveSectionSelection(nodes, 'F', null, 'a1')).toBe('A');
  });
  it('keeps an explicit pick over the open file', () => {
    expect(resolveSectionSelection(nodes, 'F', 'A', 'x')).toBe('A');
  });
  it('falls back to the first Section for a folder-level or unknown file', () => {
    expect(resolveSectionSelection(nodes, 'F', null, 'loose')).toBe('A');
    expect(resolveSectionSelection(nodes, 'F', null, 'missing')).toBe('A');
    expect(resolveSectionSelection(nodes, 'F', null)).toBe('A');
  });
  it('returns null while the folder has no Sections', () => {
    expect(resolveSectionSelection([node('G', 'folder', null), node('g1', 'file', 'G')], 'G', null, 'g1')).toBeNull();
  });
});
