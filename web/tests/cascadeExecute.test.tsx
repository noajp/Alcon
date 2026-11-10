// @vitest-environment jsdom
//
// The Cascade Object chip's execute segment (card hover-execute, PR3):
// a sibling button after the navigating pill — never nested inside
// it — carrying the rail's thick arrow; the pill's own click keeps
// opening the Object (#843), the segment's click opens the SAME
// ExecutePlanDialog Object mode the Chain's chip segment opens (PR2),
// built from the Cascade's own readings, and its Execute runs PR2's
// sequential startElementRun loop over the startable set only.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { StrategyCascade } from '@/ActivitySpace/strategy/initiative/StrategyCascade';
import type { AlconObjectWithChildren, ElementWithDetails, StrategyWithObjects } from '@/types/database';

const startElementRun = vi.fn(async (_id: string): Promise<'started' | 'busy' | 'failed'> => 'started');
vi.mock('@/AIP/ai/agentData', () => ({
  startElementRun: (id: string) => startElementRun(id),
  advanceFromElement: async () => {},
}));

vi.mock('@/hooks/useSupabase', () => ({
  useAgentRun: () => { throw new Error('the Object mode owns no run hook'); },
}));
vi.mock('@/hooks/definitionData', () => ({
  useDefinitions: () => ({ data: [] }),
  useRunRounds: () => new Map(),
}));
vi.mock('@/Function/space/activeSpaceStore', () => ({ useActiveSpaceId: () => 'space-1' }));
vi.mock('@/hooks/useInitiativeMeasures', () => ({
  useInitiativeMeasures: () => ({ measures: [], loading: false, error: null }),
}));
vi.mock('@/hooks/initiativeMissionData', () => ({
  useElementChainRows: () => ({ data: { runs: [], edges: [] }, refetch: () => {}, loading: false }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { startElementRun.mockImplementation(async () => 'started'); });

const el = (id: string, over: Record<string, unknown> = {}): ElementWithDetails => ({
  id, object_id: 'obj-1', title: `Element ${id}`, description: null, display_id: null,
  status: 'todo', priority: null, due_date: null, labels: [], assignees: [],
  ...over,
} as unknown as ElementWithDetails);

const strategy = {
  id: 's-1', name: 'Grow the thing', description: null, icon: null, color: null,
  objectIds: ['obj-1'], parentIds: [],
} as unknown as StrategyWithObjects;

const object = {
  id: 'obj-1', name: 'Launch object', icon: null, color: null,
  prefix: 'PH1', display_id: 'OBJ_PH1', domain_id: 'dom-1',
  elements: [
    el('el-1', { title: 'Write the notes', display_id: 'ELE_PH1-001' }),
    el('el-2', { title: 'Already finished', status: 'done' }),
  ],
} as unknown as AlconObjectWithChildren;

function renderCascade(withObjects = true) {
  const onOpenObject = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <StrategyCascade strategy={strategy} allStrategies={[strategy]}
          onOpenStrategy={vi.fn()} orientation="vertical"
          objects={withObjects ? [object] : undefined}
          onOpenObject={onOpenObject} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, onOpenObject };
}

/** The navigating pill's button: the one carrying the Object's name. */
function pillButton() {
  return screen.getByText('Launch object').closest('button') as HTMLButtonElement;
}

describe('StrategyCascade — the Object chip execute segment', () => {
  it('stands as a sibling after the pill, never nested inside it, with the thick arrow', () => {
    renderCascade();
    const segment = screen.getByRole('button', { name: 'Execute Object' });
    const pill = pillButton();
    expect(pill.contains(segment)).toBe(false);
    expect(segment.parentElement?.contains(pill)).toBe(true);
    expect(segment.querySelector('svg')?.getAttribute('stroke-width')).toBe('3.2');
  });

  it('renders no segment when the Cascade draws Strategies only (no Objects)', () => {
    renderCascade(false);
    expect(screen.queryByRole('button', { name: 'Execute Object' })).toBeNull();
  });

  it('the pill’s click still opens the Object and opens no dialog', () => {
    const { onOpenObject } = renderCascade();
    fireEvent.click(pillButton());
    expect(onOpenObject).toHaveBeenCalledTimes(1);
    expect(onOpenObject).toHaveBeenCalledWith('obj-1', 'dom-1');
    expect(screen.queryByText('Will start')).toBeNull();
  });

  it('the segment opens the shared Object manifest for that Object, without navigating', async () => {
    const { onOpenObject } = renderCascade();
    fireEvent.click(screen.getByRole('button', { name: 'Execute Object' }));
    expect(onOpenObject).not.toHaveBeenCalled();

    // The manifest popup (PR2's Object mode): the header's prefix, one
    // row per Element with its disposition, the start/skipped footer.
    expect(await screen.findByText('Write the notes')).toBeTruthy();
    expect(screen.getByText('PH1')).toBeTruthy();
    expect(screen.getByText('Will start')).toBeTruthy();
    expect(screen.getByText('Already finished')).toBeTruthy();
    expect(screen.getByText(/1 to start · 1 skipped/)).toBeTruthy();
  });

  it('Execute in the manifest starts exactly the startable Elements, through the shared loop', async () => {
    renderCascade();
    fireEvent.click(screen.getByRole('button', { name: 'Execute Object' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Execute' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    // The done Element never starts; the startable one goes once.
    expect(startElementRun).toHaveBeenCalledTimes(1);
    expect(startElementRun).toHaveBeenCalledWith('el-1');
  });
});
