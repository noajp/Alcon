/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OperationsNavigation, OperationsNavigationContext } from '@/ActivitySpace/sustainment/operations/OperationsNavigation';
import { normalizeOperationsParams, OPERATIONS_FIELDS, type OperationsKind } from '@/ActivitySpace/sustainment/operations/operationsModel';
import type { OperationsQueue } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import type { WidgetProps } from '@/Function/widget/types';

vi.mock('@/hooks/useOperationsTemplate', () => ({
  useOperationsTables: () => ({ data: [{ id: 'empty', name: 'Empty inventory' }], loading: false, error: null }),
  useOperationsTemplate: () => ({ creating: false, create: vi.fn() }),
}));
vi.mock('@/hooks/useWidgetTableData', () => ({ useWidgetTableData: (id: string | null) => ({
  data: id ? { table: { id, name: 'Empty inventory' }, rows: [], cellsByRow: {},
    columns: OPERATIONS_FIELDS.scm.map(field => ({ id: field.key, name: field.label, type: field.type })) } : null,
  loading: false, error: null, refetch: vi.fn(),
}) }));
vi.mock('@/Function/widget/WidgetFrame', () => ({ WidgetHeaderAction: ({ children }: { children: ReactNode }) => <>{children}</>, useWidgetMeta: () => {} }));
vi.mock('@/hooks/useOperationsAction', () => ({ useOperationsAction: () => ({}) }));
vi.mock('@/Function/shared/ExplorerDataContext', () => ({ useExplorerData: () => ({ objects: [] }) }));
const { default: OperationsPlannerWidget } = await import('@/Function/widget/widgets/OperationsPlannerWidget');

const fields = Object.fromEntries(OPERATIONS_FIELDS.scm.map(field => [field.key, field.key]));
function Harness({ kind = 'scm', connected = true, embedded = false }: { kind?: OperationsKind; connected?: boolean; embedded?: boolean }) {
  const [queue, onSelect] = useState<OperationsQueue>('overview');
  const [params, setParams] = useState(normalizeOperationsParams({ kind: 'scm', tableId: connected ? 'empty' : null, fields: connected ? fields : {} }));
  const update: WidgetProps['setParams'] = patch => setParams(current => normalizeOperationsParams({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }));
  const widget = <OperationsPlannerWidget params={params} setParams={update} host={{ subject: { kind: 'me', id: null }, elements: [] }} />;
  return embedded ? widget : <OperationsNavigationContext.Provider value={{ kind, queue, onSelect }}>
    <aside><OperationsNavigation sidebar kind={kind} queue={queue} onSelect={onSelect} /></aside>{widget}
  </OperationsNavigationContext.Provider>;
}
const navigate = (label: string) => fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: label }));
afterEach(cleanup);

describe('initial operations navigation regressions', () => {
  it('opens the empty records list and distinct risk/missing views before the first row exists', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Add your first inventory item' })).toBeTruthy();
    navigate('Inventory');
    expect(screen.getByRole('textbox', { name: 'Find items' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add your first inventory item' })).toBeNull();
    navigate('Supply risks');
    expect(screen.getByRole('heading', { name: 'Supply risks' })).toBeTruthy();
    expect(screen.getByText(/Add records before checking for risks/)).toBeTruthy();
    navigate('Missing details');
    expect(screen.getByRole('heading', { name: 'Missing details' })).toBeTruthy();
    expect(screen.getByText(/There are no records to check/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeTruthy();
  });
  it('shows the selected destination during setup, preserves typed setup input and prevents App kind drift', () => {
    render(<Harness connected={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Inventory name' }), { target: { value: 'My warehouse' } });
    navigate('Inventory');
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Inventory name' }) as HTMLInputElement).value).toBe('My warehouse');
    expect(screen.queryByRole('button', { name: 'Tool' })).toBeNull();
  });
  it('repairs an existing wrong-kind planner only through an explicit action', () => {
    render(<Harness kind="crm" />);
    expect(screen.getByText(/configured for SCM/)).toBeTruthy();
    navigate('Follow-ups');
    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set up CRM here' }));
    expect(screen.getByRole('textbox', { name: 'Pipeline name' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Inventory name' })).toBeNull();
  });
  it('leaves data settings on sidebar navigation and does not reopen them when returning', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Data settings' }));
    expect(screen.getByRole('heading', { name: 'Connect your data' })).toBeTruthy();
    navigate('Inventory');
    expect(screen.getByRole('textbox', { name: 'Find items' })).toBeTruthy();
    navigate('Overview');
    expect(screen.queryByRole('heading', { name: 'Connect your data' })).toBeNull();
  });
  it('keeps the generic embedded planner type configurable', () => {
    render(<Harness connected={false} embedded />);
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByRole('button', { name: 'Tool' })).toBeTruthy();
  });
});
