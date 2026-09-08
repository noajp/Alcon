// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { revealCustomColumn, useListColumns } from '@/ActivitySpace/execution/object/useListColumns';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
afterEach(cleanup);
const empty: CustomColumnWithValues[] = [];
describe('view column preferences', () => {
  it('keeps hidden defaults hidden across remounts', () => {
    const key = 'visibility-hide-test';
    const first = renderHook(() => useListColumns(key, empty));
    expect(first.result.current.isVisible('due_date')).toBe(true);
    act(() => first.result.current.toggleVisible('due_date'));
    expect(first.result.current.isVisible('due_date')).toBe(false);
    first.unmount();
    const second = renderHook(() => useListColumns(key, empty));
    expect(second.result.current.isVisible('due_date')).toBe(false);
    expect(JSON.parse(localStorage.getItem(`obj-list-cols:${key}:hidden`)!)).toContain('due_date');
  });
  it('keeps Object views independent and reveals a created field only once', () => {
    const field = { id: 'field-1', name: 'Stage', column_type: 'select', options: {}, values: {} } as CustomColumnWithValues;
    const a = renderHook(() => useListColumns('object:test-a', [field]));
    const b = renderHook(() => useListColumns('object:test-b', [field]));
    act(() => revealCustomColumn('object:test-a', field.id));
    expect(a.result.current.isVisible('cc:field-1')).toBe(true);
    expect(b.result.current.isVisible('cc:field-1')).toBe(false);
    act(() => a.result.current.toggleVisible('cc:field-1'));
    a.rerender();
    expect(a.result.current.isVisible('cc:field-1')).toBe(false);
  });
  it('deduplicates built-ins and saves name width', () => {
    const { result } = renderHook(() => useListColumns('width-test', empty, { extraColumns: [{ id: 'objects', label: 'Objects', kind: 'builtin', toggleable: true, defaultWidth: 160 }] }));
    expect(result.current.allColumns.filter((c) => c.id === 'objects')).toHaveLength(1);
    act(() => result.current.setWidth('__name__', 280));
    expect(result.current.widthFor('__name__')).toBe(280);
  });
});
