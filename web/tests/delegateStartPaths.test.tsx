// @vitest-environment jsdom
//
// The two ways a person starts the agent on an Element, as component
// contracts:
//   1. "Delegate to AI…" — the menu item is never disabled and never
//      relabelled into silence (while a run is open it used to be a
//      dead item that told the person nothing); selecting it fires the
//      open, and the form it opens explains the busy state inside
//      itself, with a way to the run.
//   2. The @AI mention in the comments — the comment is posted, then
//      the ask reaches onAskAgent (which starts the reply run).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { AuthContext } from '@/providers/authContext';
import { ElementActionsMenu } from '@/ActivitySpace/execution/element/ElementActionsMenu';
import { DelegateToAiForm } from '@/ActivitySpace/execution/element/agent/DelegateToAiForm';
import { ElementCommentsPanel } from '@/ActivitySpace/execution/element/ElementCommentsPanel';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';

const createElementComment = vi.fn(async (row: Record<string, unknown>) => ({
  id: 'comment-1', created_at: '2026-11-08T00:00:00Z', is_pinned: false, ...row,
}));

vi.mock('@/hooks/useSupabase', () => ({
  useElementComments: () => ({ comments: [], loading: false, reload: async () => {}, setComments: () => {} }),
  createElementComment: (row: Record<string, unknown>) => createElementComment(row),
  deleteElementComment: async () => {},
  updateElementComment: async () => {},
  fetchCommentReactions: async () => [],
  toggleReaction: async () => {},
  createElement: async () => ({}),
  deleteElement: async () => {},
  updateElement: async () => {},
  addElementToObject: async () => {},
  removeElementFromObject: async () => {},
  invalidateElementDetail: () => {},
}));

vi.mock('@/hooks/elementData', () => ({
  fetchElementMoveTargets: async () => [],
  fetchElementObjectIds: async () => [],
}));

afterEach(cleanup);

const element = { id: 'el-1', object_id: null, title: 'Smoke', status: 'todo', labels: [], assignees: [] } as unknown as ElementWithDetails;
const aiWorker = { id: 'w-ai', name: 'Athena', type: 'ai_agent', user_id: null } as unknown as Worker;

function renderMenu(onDelegateToAi: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ElementActionsMenu element={element} onDelegateToAi={onDelegateToAi} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('Delegate to AI… — the menu item', () => {
  it('is enabled, keeps its name, and selecting it opens the form', async () => {
    const onDelegateToAi = vi.fn();
    renderMenu(onDelegateToAi);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Element actions' }), { button: 0, ctrlKey: false });
    const item = await screen.findByRole('menuitem', { name: /Delegate to AI/ });
    expect(item.getAttribute('aria-disabled')).not.toBe('true');
    expect(item.hasAttribute('data-disabled')).toBe(false);
    fireEvent.click(item);
    expect(onDelegateToAi).toHaveBeenCalledTimes(1);
  });
});

describe('DelegateToAiForm — the dialog’s content', () => {
  it('idle: Run starts the run and the caller closes', async () => {
    const onStart = vi.fn(async () => 'started' as const);
    const onStarted = vi.fn();
    render(
      <I18nProvider>
        <DelegateToAiForm aiWorkers={[aiWorker]} defaultWorkerId="w-ai"
          onStart={onStart} onStarted={onStarted} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(onStart).toHaveBeenCalledWith({ workerId: 'w-ai', prompt: '' });
  });

  it('busy: the form explains itself, offers the way to the run, and Run is off', async () => {
    const onStart = vi.fn(async () => 'started' as const);
    const onViewRun = vi.fn();
    render(
      <I18nProvider>
        <DelegateToAiForm aiWorkers={[aiWorker]} defaultWorkerId="w-ai" busy
          onStart={onStart} onStarted={() => {}} onViewRun={onViewRun} />
      </I18nProvider>,
    );
    expect(screen.getByText(/The agent is already working on this Element/)).toBeTruthy();
    const runButton = screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'View the run' }));
    expect(onViewRun).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('a start that answers busy explains that too', async () => {
    const onStart = vi.fn(async () => 'busy' as const);
    render(
      <I18nProvider>
        <DelegateToAiForm aiWorkers={[aiWorker]} defaultWorkerId="w-ai"
          onStart={onStart} onStarted={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText(/The agent is already working on this Element/)).toBeTruthy();
  });
});

describe('the @AI mention — the other start path', () => {
  it('posting "@AI …" asks the agent with the posted comment’s id', async () => {
    const onAskAgent = vi.fn(async () => 'started' as const);
    render(
      <AuthContext.Provider value={{ user: { id: 'u-1', email: 'a@example.com' }, profile: { display_name: 'Taka' } } as never}>
        <I18nProvider>
          <ElementCommentsPanel elementId="el-1" workers={[aiWorker]} onAskAgent={onAskAgent} />
        </I18nProvider>
      </AuthContext.Provider>,
    );
    const box = screen.getByPlaceholderText(/Write an update/);
    fireEvent.change(box, { target: { value: '@AI 調べてください' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAskAgent).toHaveBeenCalledTimes(1));
    expect(createElementComment).toHaveBeenCalledTimes(1);
    expect(onAskAgent).toHaveBeenCalledWith({ prompt: '@AI 調べてください', commentId: 'comment-1', workerId: null });
  });

  it('a comment without a mention does not ask the agent', async () => {
    const onAskAgent = vi.fn(async () => 'started' as const);
    render(
      <AuthContext.Provider value={{ user: { id: 'u-1', email: 'a@example.com' }, profile: { display_name: 'Taka' } } as never}>
        <I18nProvider>
          <ElementCommentsPanel elementId="el-1" workers={[aiWorker]} onAskAgent={onAskAgent} />
        </I18nProvider>
      </AuthContext.Provider>,
    );
    const box = screen.getByPlaceholderText(/Write an update/);
    fireEvent.change(box, { target: { value: 'ただの近況です' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(createElementComment).toHaveBeenCalled());
    expect(onAskAgent).not.toHaveBeenCalled();
  });
});
