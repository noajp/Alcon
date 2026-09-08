/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataTableSchema } from '@/ActivitySpace/sustainment/table/data';

const mocks = vi.hoisted(() => ({ read: vi.fn(), setCell: vi.fn() }));
vi.mock('@/ActivitySpace/sustainment/table/data', () => ({
  DATA_TABLES_QUERY_KEY: ['data-tables'],
  fetchDataTableSchema: mocks.read,
  setDataTableCell: mocks.setCell,
  addDataTableColumn: vi.fn(), addDataTableRow: vi.fn(),
  createDataTable: vi.fn(), deleteDataTable: vi.fn(), updateDataTable: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => {
    let id = '';
    const query = {
      select: () => query,
      eq: (column: string, value: string) => { if (column === 'id') id = value; return query; },
      single: async () => ({ data: { id }, error: null }),
    };
    return query;
  } },
}));

import { useTableData } from '@/ActivitySpace/sustainment/table/useTableData';
import { useWidgetTableData } from '@/hooks/useWidgetTableData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const schema = (value: string): DataTableSchema => ({ columns: [], rows: [], cellsByRow: { row: { column: value } } });
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  return { client, wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) };
}
beforeEach(() => { mocks.read.mockReset(); mocks.setCell.mockReset(); });
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe('shared Table data', () => {
  it('shares a read and server-confirmed updates between the Table app and Widget', async () => {
    let value = 'before';
    mocks.read.mockImplementation(async () => schema(value));
    mocks.setCell.mockImplementation(async (_row, _column, next) => { value = next; });
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ app: useTableData('a'), widget: useWidgetTableData('a') }), { wrapper });
    await waitFor(() => expect(result.current.app.data).toBeDefined());
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(result.current.app.data).toBe(result.current.widget.data);
    await act(async () => { await result.current.widget.setCell('row', 'column', 'after'); });
    await waitFor(() => expect(result.current.app.data?.cellsByRow.row.column).toBe('after'));
    expect(result.current.app.data).toBe(result.current.widget.data);
  });

  it('does not paint a late Table A read under Table B', async () => {
    const first = deferred<DataTableSchema>();
    mocks.read.mockImplementation((id) => id === 'a' ? first.promise : Promise.resolve(schema('B')));
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ id }) => useTableData(id), { wrapper, initialProps: { id: 'a' } });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('a'));
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data?.table.id).toBe('b'));
    await act(async () => { first.resolve(schema('A')); await first.promise; });
    expect(result.current.data?.cellsByRow.row.column).toBe('B');
    expect(result.current.data?.table.id).toBe('b');
  });

  it('serializes consumers, retains saved values on failure and resumes queued edits', async () => {
    let value = 'saved';
    const first = deferred<void>();
    mocks.read.mockImplementation(async () => schema(value));
    mocks.setCell.mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async (_row, _column, next) => { value = next; });
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ app: useTableData('a'), widget: useWidgetTableData('a') }), { wrapper });
    await waitFor(() => expect(result.current.app.data).toBeDefined());
    let failed!: Promise<unknown>;
    let queued!: Promise<void>;
    act(() => {
      failed = result.current.app.setCell('row', 'column', 'lost').catch((error) => error);
      queued = result.current.widget.setCell('row', 'column', 'latest');
    });
    await waitFor(() => expect(mocks.setCell).toHaveBeenCalledTimes(1));
    expect(result.current.app.data?.cellsByRow.row.column).toBe('saved');
    await act(async () => { first.reject(new Error('offline')); await failed; await queued; });
    expect(await failed).toEqual(new Error('offline'));
    expect(mocks.setCell).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.app.data?.cellsByRow.row.column).toBe('latest'));
  });

  it('settles and refreshes the originating Table after its consumer switches Table', async () => {
    let valueA = 'before';
    const write = deferred<void>();
    mocks.read.mockImplementation(async (id) => schema(id === 'a' ? valueA : 'B'));
    mocks.setCell.mockImplementation(async () => { await write.promise; valueA = 'after'; });
    const { wrapper, client } = setup();
    const { result, rerender } = renderHook(({ id }) => useTableData(id), { wrapper, initialProps: { id: 'a' } });
    const observer = renderHook(() => useWidgetTableData('a'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    let saved!: Promise<void>;
    act(() => { saved = result.current.setCell('row', 'column', 'after'); });
    await waitFor(() => expect(mocks.setCell).toHaveBeenCalled());
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data?.table.id).toBe('b'));
    await act(async () => { write.resolve(); await saved; });
    await waitFor(() => expect(observer.result.current.data?.cellsByRow.row.column).toBe('after'));
    expect(result.current.data?.cellsByRow.row.column).toBe('B');
    expect(client.getQueryState(['widget-table-data', 'a'])?.isInvalidated).toBe(false);
  });
});
