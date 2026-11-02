//
// Board / Calendar / Gantt show the Elements the List's filtered sections
// show — each once, in section order.

import { describe, expect, it } from 'vitest';
import { sectionElements } from '@/ActivitySpace/execution/element/sectionElements';
import type { ListSection } from '@/Function/shared/listTable/shared';
import type { ElementWithDetails } from '@/hooks/useSupabase';

const el = (id: string) => ({ id }) as unknown as ElementWithDetails;
const section = (id: string, ids: string[]) =>
  ({ id, name: id, objects: [], elements: ids.map(el) }) as ListSection;

describe('sectionElements', () => {
  it('flattens sections in order', () => {
    expect(sectionElements([section('a', ['1', '2']), section('b', ['3'])]).map((e) => e.id))
      .toEqual(['1', '2', '3']);
  });

  it('keeps an Element that sits in two bands once', () => {
    expect(sectionElements([section('a', ['1', '2']), section('b', ['2', '3'])]).map((e) => e.id))
      .toEqual(['1', '2', '3']);
  });

  it('is empty when the filter leaves no sections', () => {
    expect(sectionElements([])).toEqual([]);
  });
});
