/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OperationsNavigation, OperationsNavigationContext } from '@/ActivitySpace/sustainment/operations/OperationsNavigation';
import { normalizeOperationsParams, OPERATIONS_FIELDS } from '@/Function/operations/operationsModel';
import type { OperationsQueue } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import type { WidgetProps } from '@/Function/widget/types';

vi.mock('@/hooks/useOperationsTemplate', () => ({
  useOperationsTables: () => ({ data: [{ id: 'empty', name: 'Empty pipeline' }], loading: false, error: null }),
  useOperationsTemplate: () => ({ creating: false, create: vi.fn() }),
}));
vi.mock('@/hooks/useTableData', () => ({ useTableData: (id: string | null) => ({
  data: id ? { table: { id, name: 'Empty pipeline' }, rows: [], cellsByRow: {},
    columns: OPERATIONS_FIELDS.map(field => ({ id: field.key, name: field.label, type: field.type })) } : null,
  loading: false, error: null, refetch: vi.fn(),
}) }));
vi.mock('@/Function/widget/WidgetFrame', () => ({ WidgetHeaderAction: ({ children }: { children: ReactNode }) => <>{children}</>, useWidgetMeta: () => {} }));
vi.mock('@/hooks/useOperationsAction', () => ({ useOperationsAction: () => ({}) }));
vi.mock('@/Function/shared/ExplorerDataContext', () => ({ useExplorerData: () => ({ objects: [] }) }));
const { default: OperationsPlannerWidget } = await import('@/Function/widget/widgets/OperationsPlannerWidget');

const fields = Object.fromEntries(OPERATIONS_FIELDS.map(field => [field.key, field.key]));
/** Stores raw params and merges patches the way a saved board does; the registry normalizes on read. */
function Harness({ connected = true, initial, onSaved }: { connected?: boolean; initial?: WidgetProps['params']; onSaved?: (params: WidgetProps['params']) => void }) {
  const [queue, onSelect] = useState<OperationsQueue>('overview');
  const [params, setParams] = useState<WidgetProps['params']>(initial ?? { kind: 'crm', tableId: connected ? 'empty' : null, fields: connected ? fields : {} });
  const update: WidgetProps['setParams'] = patch => setParams(current => {
    const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    onSaved?.(next);
    return next;
  });
  return <OperationsNavigationContext.Provider value={{ queue, onSelect }}>
    <aside><OperationsNavigation sidebar queue={queue} onSelect={onSelect} /></aside>
    <OperationsPlannerWidget params={normalizeOperationsParams(params)} setParams={update} host={{ subject: { kind: 'me', id: null }, elements: [] }} />
  </OperationsNavigationContext.Provider>;
}
const navigate = (label: string) => fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: label }));
afterEach(cleanup);

describe('initial operations navigation regressions', () => {
  it('opens the empty records list and distinct follow-up/missing views before the first row exists', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Add your first opportunity' })).toBeTruthy();
    navigate('Opportunities');
    expect(screen.getByRole('textbox', { name: 'Find opportunities' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Add your first opportunity' })).toBeNull();
    navigate('Follow-ups');
    expect(screen.getByRole('heading', { name: 'Follow-ups' })).toBeTruthy();
    expect(screen.getByText(/Add records before checking for risks/)).toBeTruthy();
    navigate('Missing details');
    expect(screen.getByRole('heading', { name: 'Missing details' })).toBeTruthy();
    expect(screen.getByText(/There are no records to check/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add opportunity' })).toBeTruthy();
  });
  it('shows the selected destination during setup and preserves typed setup input', () => {
    render(<Harness connected={false} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pipeline name' }), { target: { value: 'Enterprise deals' } });
    navigate('Opportunities');
    expect(screen.getByRole('heading', { name: 'Opportunities' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Pipeline name' }) as HTMLInputElement).value).toBe('Enterprise deals');
  });
  it('opens setup for a placement saved with another kind and stamps CRM on the next write', () => {
    const saved: WidgetProps['params'][] = [];
    render(<Harness initial={{ kind: 'other', tableId: 'empty', fields }} onSaved={params => saved.push(params)} />);
    expect(screen.getByRole('textbox', { name: 'Pipeline name' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use an existing Table' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Source Table' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Empty pipeline' }));
    expect(saved.at(-1)).toMatchObject({ kind: 'crm', tableId: 'empty', fields: {} });
    expect(screen.getByRole('heading', { name: 'Connect your data' })).toBeTruthy();
  });
  it('leaves data settings on sidebar navigation and does not reopen them when returning', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Data settings' }));
    expect(screen.getByRole('heading', { name: 'Connect your data' })).toBeTruthy();
    navigate('Opportunities');
    expect(screen.getByRole('textbox', { name: 'Find opportunities' })).toBeTruthy();
    navigate('Overview');
    expect(screen.queryByRole('heading', { name: 'Connect your data' })).toBeNull();
  });
});
