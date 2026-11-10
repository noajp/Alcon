// @vitest-environment jsdom
//
// The Execute popup's Object mode (card hover-execute, PR2): a
// manifest, not a plan — every Element of the Object with its
// disposition word, the startable first; Execute runs the sequential
// startElementRun loop over exactly the startable set (a person's own
// task is never started, a blocked Element is not chained), and each
// row flips to its outcome. No plan run is started for a set.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { ExecutePlanDialog, type ObjectExecuteTarget } from '@/ActivitySpace/execution/element/agent/ExecutePlanDialog';
import type { ManifestElementRow } from '@/Function/shared/element/objectExecuteManifest';

const startElementRun = vi.fn(async (_id: string): Promise<'started' | 'busy' | 'failed'> => 'started');
vi.mock('@/AIP/ai/agentData', () => ({
  startElementRun: (id: string) => startElementRun(id),
}));

vi.mock('@/hooks/useSupabase', () => ({
  useAgentRun: () => { throw new Error('the Object mode owns no run hook'); },
}));
vi.mock('@/hooks/definitionData', () => ({ useDefinitions: () => ({ data: [] }) }));
vi.mock('@/Function/space/activeSpaceStore', () => ({ useActiveSpaceId: () => 'space-1' }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => { startElementRun.mockImplementation(async () => 'started'); });

const el = (id: string, over: Partial<ManifestElementRow> = {}): ManifestElementRow => ({
  id, title: `Element ${id}`, display_id: null, status: 'todo', assignee: null, assigneeName: null, ...over,
});

function target(over: Partial<ObjectExecuteTarget> = {}): ObjectExecuteTarget {
  return {
    id: 'obj-1', name: 'Launch object', icon: null, color: null,
    prefixLabel: 'PH1', domainName: 'Sales',
    manifest: {
      elements: [
        el('done-1', { status: 'done', title: 'Already finished' }),
        el('person-1', { assignee: 'human', assigneeName: 'Hina', title: 'Decide the price' }),
        el('blocked-1', { title: 'Ship it' }),
        el('start-1', { title: 'Write the notes', display_id: 'ELE_PH1-001' }),
        el('start-2', { title: 'Draft the post' }),
      ],
      edges: [{ from_element: 'start-2', to_element: 'blocked-1' }],
      runs: [],
    },
    ...over,
  };
}

function renderDialog(tgt: ObjectExecuteTarget) {
  const onOpenChange = vi.fn();
  const onFinished = vi.fn();
  const view = render(
    <I18nProvider>
      <ExecutePlanDialog target={{ kind: 'object', object: tgt }} open onOpenChange={onOpenChange} onFinished={onFinished} />
    </I18nProvider>,
  );
  return { ...view, onOpenChange, onFinished };
}

describe('ExecutePlanDialog — the Object manifest', () => {
  it('renders the header (icon name, prefix, Domain) and every row with its disposition, startable first', () => {
    renderDialog(target());
    // The name stands in the dialog's description and in the body's header row.
    expect(screen.getAllByText('Launch object')).toHaveLength(2);
    expect(screen.getByText('PH1')).toBeTruthy();
    expect(screen.getByText('Sales')).toBeTruthy();

    const titles = screen.getAllByText(/Write the notes|Draft the post|Ship it|Decide the price|Already finished/)
      .map((n) => n.textContent)
      .filter((text) => !text?.startsWith('Waiting on'));
    expect(titles).toEqual(['Write the notes', 'Draft the post', 'Ship it', 'Decide the price', 'Already finished']);
    expect(screen.getAllByText('Will start')).toHaveLength(2);
    expect(screen.getByText('Waiting on Draft the post')).toBeTruthy();
    expect(screen.getByText('With Hina')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('PH1-001')).toBeTruthy();
    expect(screen.getByText(/2 to start · 3 skipped/)).toBeTruthy();
    expect(screen.getByText(/Runs that later need an approval deliver it to the Inbox/)).toBeTruthy();
  });

  it('Execute starts exactly the startable set, sequentially, and flips each row to its outcome', async () => {
    const order: string[] = [];
    startElementRun.mockImplementation(async (id: string) => {
      order.push(id);
      return id === 'start-2' ? 'busy' : 'started';
    });
    const { onFinished } = renderDialog(target());

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());

    // The person's task, the blocked Element and the done one never start.
    expect(order).toEqual(['start-1', 'start-2']);
    expect(screen.getByText('Already running')).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('a failed start reads plainly on its row and does not stop the loop', async () => {
    startElementRun.mockImplementation(async (id: string) => (id === 'start-1' ? 'failed' : 'started'));
    renderDialog(target());
    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy());
    expect(startElementRun).toHaveBeenCalledTimes(2);
    const failed = screen.getByText('Could not start the run.');
    expect(failed.className).toContain('status-danger');
  });

  it('nothing startable disables Execute; an empty Object says so with a zero footer', () => {
    renderDialog(target({
      manifest: { elements: [el('done-1', { status: 'done' })], edges: [], runs: [] },
    }));
    expect(screen.getByRole('button', { name: 'Execute' })).toHaveProperty('disabled', true);
    cleanup();

    renderDialog(target({ manifest: { elements: [], edges: [], runs: [] } }));
    expect(screen.getByText('This Object has no Elements yet.')).toBeTruthy();
    expect(screen.getByText(/0 to start · 0 skipped/)).toBeTruthy();
  });

  it('Dismiss closes without starting anything', async () => {
    const { onOpenChange } = renderDialog(target());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(startElementRun).not.toHaveBeenCalled();
  });
});
