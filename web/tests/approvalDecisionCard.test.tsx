// @vitest-environment jsdom
//
// The shared decision card's contract, from the outside: who may decide
// sees Allow/Deny and who may not does not; a standing approval is
// offered only when the surface passes an owner AND the engine marked
// the calls rememberable (a mode-ask display is not, so the chips stay
// hidden); the deadline line exists only when the action carries one;
// a settled action reads its outcome instead of buttons.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';
import type { AgentAction } from '@/types/database';

afterEach(cleanup);

function action(over: Partial<AgentAction> = {}): AgentAction {
  return {
    id: 'act-1',
    run_id: 'run-1',
    element_id: null,
    tool: '',
    input: {
      calls: [{ id: 'a', name: 'github__create_pull_request', input: { owner: 'noajp', repo: 'Alcon', title: 'Add the card', base: 'main', head: 'claude/card', body: 'The body.' } }],
      display: [{
        id: 'a', integration: 'GitHub', operation: 'create_pull_request', destination: 'https://api.github.com',
        detail: null, effect: 'write', critical: null, rememberable: true,
        title: 'Create a pull request',
        fields: [{ label: 'Repository', value: 'Alcon' }, { label: 'Title', value: 'Add the card' }],
        preview: 'The body.', askReason: 'command',
      }],
    } as AgentAction['input'],
    input_hash: 'hash-1',
    summary: 'GitHub · create_pull_request',
    integration_id: null,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    result: null,
    expires_at: null,
    created_at: '2026-11-08T00:00:00Z',
    ...over,
  };
}

function renderCard(props: Partial<Parameters<typeof ApprovalDecisionCard>[0]> = {}) {
  const onDecide = vi.fn(async () => {});
  const view = render(
    <I18nProvider>
      <ApprovalDecisionCard action={action()} surface="panel" canDecide onDecide={onDecide} {...props} />
    </I18nProvider>,
  );
  return { ...view, onDecide };
}

describe('ApprovalDecisionCard', () => {
  it('shows the action as a sentence with its labeled fields, preview and why it asks', () => {
    renderCard();
    expect(screen.getByText('GitHub · Create a pull request')).toBeTruthy();
    expect(screen.getByText('Repository')).toBeTruthy();
    expect(screen.getByText('The body.')).toBeTruthy();
    expect(screen.getByText('This command is set to “Asks first”.')).toBeTruthy();
  });

  it('offers Allow and Deny only to who may decide, and decides with the note', async () => {
    const { onDecide } = renderCard();
    fireEvent.change(screen.getByLabelText('Note to the agent (optional)'), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByText('Approve and run'));
    expect(onDecide).toHaveBeenCalledWith(true, { note: 'ship it' });

    cleanup();
    renderCard({ canDecide: false });
    expect(screen.queryByText('Approve and run')).toBeNull();
    expect(screen.queryByText('Deny')).toBeNull();
    expect(screen.getByText('Waiting for the person who started this run to approve.')).toBeTruthy();
  });

  it('offers remember chips to an owner for rememberable calls, and hides them when the display is not rememberable', () => {
    renderCard({ canRemember: true });
    expect(screen.getByText(/Don’t ask again for/)).toBeTruthy();

    cleanup();
    const modeAsk = action();
    (modeAsk.input as { display: { rememberable: boolean }[] }).display[0].rememberable = false;
    renderCard({ canRemember: true, action: modeAsk });
    expect(screen.queryByText(/Don’t ask again for/)).toBeNull();

    cleanup();
    renderCard({ canRemember: false });
    expect(screen.queryByText(/Don’t ask again for/)).toBeNull();
  });

  it('shows the deadline only when the action carries one', () => {
    renderCard();
    expect(screen.queryByText(/Waiting for a decision until/)).toBeNull();
    cleanup();
    renderCard({ action: action({ expires_at: '2026-11-15T00:00:00Z' }) });
    expect(screen.getByText(/Waiting for a decision until/)).toBeTruthy();
  });

  it('settles into its outcome instead of buttons', () => {
    renderCard({ action: action({ status: 'rejected' }) });
    expect(screen.getByText('You denied this operation. It was not run.')).toBeTruthy();
    expect(screen.queryByText('Approve and run')).toBeNull();

    cleanup();
    renderCard({ action: action({ status: 'expired' }) });
    expect(screen.getByText('This approval expired undecided. It was not run.')).toBeTruthy();

    cleanup();
    renderCard({
      action: action({ status: 'executed' }),
      results: [{ name: 'github__create_pull_request', ok: true, content: 'PR #42 opened' }],
    });
    expect(screen.getByText(/PR #42 opened/)).toBeTruthy();
  });

  it('labels a compensation batch as a failed run’s rollback, with its own deny wording (B9)', () => {
    const compAction = action();
    (compAction.input as unknown as { compensation: unknown }).compensation = {
      setSize: 1, failureSummary: 'The run failed midway',
    };
    renderCard({ action: compAction });
    expect(screen.getByText('Compensation for a failed run: approving runs these undo operations to roll back what the failed run wrote.')).toBeTruthy();
    expect(screen.getByText('Denying leaves the failed run\'s writes as they are; nothing is rolled back.')).toBeTruthy();

    cleanup();
    renderCard({ action: action({
      status: 'rejected',
      input: { ...compAction.input } as AgentAction['input'],
    }) });
    expect(screen.getByText('You denied this compensation. The failed run\'s writes were not rolled back.')).toBeTruthy();
  });
});
