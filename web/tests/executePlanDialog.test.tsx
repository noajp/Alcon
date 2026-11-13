// @vitest-environment jsdom
//
// The Execute popup's contract, from the outside (card hover-execute
// PR1): opening it starts a plan run at once; a sealed plan lists its
// calls in order with critical marks, verify lines and policy-denied
// calls that no approval covers; Execute decides the plan through the
// run hook's decide (the decideAgentAction path); Dismiss cancels the
// undecided plan; another person's run is read-only; a plan that
// recorded no writes says so.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { ExecutePlanDialog } from '@/ActivitySpace/execution/element/agent/ExecutePlanDialog';
import type { AgentAction, ElementWithDetails } from '@/types/database';

const agentStub = {
  run: null as unknown,
  steps: [] as unknown[],
  pending: null as unknown,
  outputs: [] as unknown[],
  loading: false,
  starting: false,
  deciding: false,
  error: null as string | null,
  isActive: false,
  isMine: true,
  start: vi.fn(async () => 'busy' as const),
  cancel: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
  decide: vi.fn(async () => {}),
};

vi.mock('@/hooks/useSupabase', () => ({
  useAgentRun: () => agentStub,
}));

const definitionsStub: { data: unknown[] } = { data: [] };
vi.mock('@/hooks/definitionData', () => ({
  useDefinitions: () => definitionsStub,
}));

vi.mock('@/Function/space/activeSpaceStore', () => ({
  useActiveSpaceId: () => 'space-1',
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  agentStub.run = null;
  agentStub.pending = null;
  agentStub.steps = [];
  agentStub.error = null;
  agentStub.isMine = true;
  definitionsStub.data = [];
});

const element = {
  id: 'el-1', object_id: null, title: 'Write the report', status: 'todo',
  labels: [], assignees: [], definition_id: null,
} as unknown as ElementWithDetails;

function run(over: Record<string, unknown> = {}) {
  return {
    id: 'run-1', element_id: 'el-1', status: 'running', plan_mode: true,
    triggered_by: 'u-1', summary: null, error: null, cost_usd: 0,
    started_at: '2026-11-10T00:00:00Z', finished_at: null,
    verdict: null, proposed_readings: null, chainScope: null,
    ...over,
  };
}

function planAction(calls: unknown[], display: unknown[]): AgentAction {
  return {
    id: 'act-plan', run_id: 'run-1', element_id: 'el-1', tool: 'plan',
    input: { calls, display } as AgentAction['input'],
    input_hash: 'plan-hash', summary: '計画: GitHub', integration_id: null,
    status: 'pending', decided_by: null, decided_at: null, decision_note: null,
    result: null, expires_at: null, created_at: '2026-11-10T00:00:00Z',
  } as AgentAction;
}

const sealedDisplay = [
  {
    id: 'a', integration: 'GitHub', operation: 'create_pull_request', destination: 'https://api.github.com',
    detail: null, effect: 'write', critical: null, rememberable: false,
    title: 'Create a pull request',
    fields: [
      { label: 'Repository', value: 'Clayware' },
      { label: '読み戻し確認', value: '「get_pull_request」で title を照合します' },
    ],
    preview: null, askReason: null,
  },
  {
    id: 'b', integration: 'GitHub', operation: 'delete_file', destination: 'https://api.github.com',
    detail: null, effect: 'write', critical: 'delete', rememberable: false,
    title: 'Delete a file',
    fields: [
      { label: 'Path', value: 'old.md' },
      { label: 'ポリシー', value: 'この引数では拒否されています。承認しても実行されません' },
    ],
    preview: null, askReason: null,
  },
];
const sealedCalls = [
  { id: 'a', name: 'github__create_pull_request', input: { repo: 'Clayware' } },
  { id: 'b', name: 'github__delete_file', input: { path: 'old.md' } },
];

function renderDialog(el: ElementWithDetails = element) {
  const onOpenChange = vi.fn();
  const view = render(
    <I18nProvider>
      <ExecutePlanDialog element={el} open onOpenChange={onOpenChange} />
    </I18nProvider>,
  );
  return { ...view, onOpenChange };
}

describe('ExecutePlanDialog — the plan surface', () => {
  it('opening the popup starts a plan run immediately, from the board', async () => {
    agentStub.run = run();
    renderDialog();
    await waitFor(() => expect(agentStub.start).toHaveBeenCalledTimes(1));
    expect(agentStub.start).toHaveBeenCalledWith(expect.objectContaining({ planMode: true, triggeredFrom: 'board' }));
    // While it rehearses, the popup is honest about what is real.
    expect(screen.getByText('Reads are happening for real; writes are being recorded, not executed.')).toBeTruthy();
  });

  it('shows the declared outline of the Element’s own definition while planning', async () => {
    agentStub.run = run();
    definitionsStub.data = [{
      id: 'def-1', name: 'Weekly report definition', enabled: true,
      body: '# 目的\n報告\n\n# 進め方\n- 資料を読む\n- 下書きを書く',
    }];
    renderDialog({ ...element, definition_id: 'def-1' } as ElementWithDetails);
    expect(await screen.findByText('Weekly report definition')).toBeTruthy();
    expect(screen.getByText('資料を読む')).toBeTruthy();
    expect(screen.getByText('下書きを書く')).toBeTruthy();
  });

  it('a sealed plan lists its calls in order, with critical marks, verify lines and denied calls in the danger tone', async () => {
    agentStub.run = run({ status: 'awaiting_approval' });
    agentStub.pending = planAction(sealedCalls, sealedDisplay);
    renderDialog();

    const titles = screen.getAllByText(/Create a pull request|Delete a file/);
    expect(titles[0].textContent).toContain('Create a pull request');
    expect(titles[1].textContent).toContain('Delete a file');
    expect(screen.getByText('Critical · Delete')).toBeTruthy();
    expect(screen.getByText('「get_pull_request」で title を照合します')).toBeTruthy();
    const denied = screen.getByText('この引数では拒否されています。承認しても実行されません');
    expect(denied.className).toContain('status-danger');
    expect(screen.getByText(/2 writes/)).toBeTruthy();
    expect(screen.getByText(/1 critical/)).toBeTruthy();
    expect(screen.getByText('Only the calls listed here, with exactly these arguments, are covered by this one approval.')).toBeTruthy();
    // No definition on this Element: the rehearsal honesty line stands.
    expect(screen.getByText(/This plan is what the rehearsal recorded/)).toBeTruthy();
  });

  it('Execute decides the plan through the run’s decide; Dismiss cancels the undecided plan and closes', async () => {
    agentStub.run = run({ status: 'awaiting_approval' });
    agentStub.pending = planAction(sealedCalls, sealedDisplay);
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
    await waitFor(() => expect(agentStub.decide).toHaveBeenCalledWith(true));
    expect(agentStub.cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(agentStub.cancel).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a plan that recorded no writes says so, with its zero footer', async () => {
    agentStub.run = run({ status: 'awaiting_approval' });
    agentStub.pending = planAction([], []);
    renderDialog();
    expect(await screen.findByText('No writes were recorded.')).toBeTruthy();
    expect(screen.getByText(/0 writes/)).toBeTruthy();
  });

  it("another person's plan renders read-only: no Execute, and Dismiss does not cancel their run", async () => {
    agentStub.run = run({ status: 'awaiting_approval' });
    agentStub.pending = planAction(sealedCalls, sealedDisplay);
    agentStub.isMine = false;
    const { onOpenChange } = renderDialog();

    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
    expect(screen.getByText('Waiting for the person who started this run to approve.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(agentStub.cancel).not.toHaveBeenCalled();
  });
});
