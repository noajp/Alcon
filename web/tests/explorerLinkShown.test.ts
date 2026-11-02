import { describe, expect, it } from 'vitest';
import { linkAlreadyShown, type ExplorerData } from '@/Function/sync/explorerPatch';

const data = (objects: { id: string; elements: string[] }[]): ExplorerData => ({
  objects: objects.map((o) => ({ id: o.id, elements: o.elements.map((id) => ({ id })) })) as never,
  rootElements: [],
});

describe('a new Element↔Object link refetches the tree only when a list would change', () => {
  it('skips when every list holding the Object already shows the Element', () => {
    expect(linkAlreadyShown([data([{ id: 'o1', elements: ['e1'] }]), data([{ id: 'o2', elements: [] }])], 'e1', 'o1')).toBe(true);
  });
  it('refetches when a list holds the Object without the Element (a new home)', () => {
    expect(linkAlreadyShown([data([{ id: 'o1', elements: ['e9'] }])], 'e1', 'o1')).toBe(false);
  });
  it('skips when no cached list holds the Object', () => {
    expect(linkAlreadyShown([data([{ id: 'o2', elements: [] }])], 'e1', 'o1')).toBe(true);
    expect(linkAlreadyShown([], 'e1', 'o1')).toBe(true);
  });
});
