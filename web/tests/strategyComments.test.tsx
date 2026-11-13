/** @vitest-environment jsdom */
//
// The Strategy thread is the surface the whole "give the Strategy an
// instruction" loop rests on, so the things worth pinning down are the ones
// that lose a person's words without saying so:
//
//   - a post that fails must not swallow the draft,
//   - a delete that fails must put the comment back,
//   - the delete button must only appear where the database would allow it
//     (own comment, or the Strategy's owner) — an offer the RLS policy will
//     refuse is worse than no button.
//
// tsc and design-lint pass on a version that gets every one of these wrong.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StrategyComment } from '@/types/database';

const USER_ID = 'user-1';
const OTHER_ID = 'user-2';

const createStrategyComment = vi.fn();
const deleteStrategyComment = vi.fn();
let thread: StrategyComment[] = [];

function comment(over: Partial<StrategyComment> = {}): StrategyComment {
  return {
    id: 'c1',
    strategy_id: 's1',
    parent_id: null,
    author_id: USER_ID,
    author_kind: 'human',
    author_name: 'You',
    content: 'a thing worth saying',
    mentions: [],
    is_pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

vi.mock('@/hooks/useSupabase', () => ({
  createStrategyComment: (...args: unknown[]) => createStrategyComment(...args),
  deleteStrategyComment: (...args: unknown[]) => deleteStrategyComment(...args),
  // Stands in for the live hook: the component owns the list after mount, so
  // the test drives it through the setter exactly as the real hook does.
  useStrategyComments: () => {
    const [comments, setComments] = require('react').useState(thread);
    return { comments, reload: () => {}, setComments };
  },
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    user: { id: USER_ID, email: 'me@example.com' },
    profile: { display_name: 'Me' },
  }),
}));

// Imported after the mocks so the component picks them up.
const { StrategyCommentsPanel } = await import('@/ActivitySpace/strategy/initiative/StrategyCommentsPanel');

function setup(overrides: Partial<Parameters<typeof StrategyCommentsPanel>[0]> = {}) {
  render(
    <StrategyCommentsPanel
      strategyId="s1"
      strategyName="Clayware"
      strategyOwnerId={USER_ID}
      workers={[]}
      {...overrides}
    />,
  );
  return screen.getByPlaceholderText(/Comment on Clayware/i) as HTMLTextAreaElement;
}

beforeEach(() => {
  thread = [];
  createStrategyComment.mockReset();
  deleteStrategyComment.mockReset();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Strategy comments', () => {
  // Default send shortcut (Settings > Preferences, unset) is ⌘+Enter — see
  // preferencesStore.test.ts. Plain Enter must NOT send in that mode; a
  // user who explicitly picked 'Enter' is covered separately below.
  it('posts on ⌘+Enter and clears the draft', async () => {
    createStrategyComment.mockImplementation(async (input: { content: string }) =>
      comment({ id: 'new', content: input.content }));
    const box = setup();

    fireEvent.change(box, { target: { value: 'the assumption no longer holds' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(createStrategyComment).not.toHaveBeenCalled(); // plain Enter is a newline in this mode
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });

    await vi.waitFor(() => expect(createStrategyComment).toHaveBeenCalledTimes(1));
    expect(createStrategyComment.mock.calls[0][0]).toMatchObject({
      strategy_id: 's1',
      author_id: USER_ID,
      author_kind: 'human',
      content: 'the assumption no longer holds',
    });
    await vi.waitFor(() => expect(box.value).toBe(''));
    await screen.findByText('the assumption no longer holds');
  });

  it('keeps the draft when the post fails', async () => {
    createStrategyComment.mockRejectedValue(new Error('offline'));
    const box = setup();

    fireEvent.change(box, { target: { value: 'do not lose this' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });

    await vi.waitFor(() => expect(createStrategyComment).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(box.value).toBe('do not lose this'));
    // ...and it was never faked into the thread as if it had posted.
    expect(document.querySelectorAll('li')).toHaveLength(0);
  });

  it('does not post mid-IME-composition or on Shift+⌘+Enter', () => {
    const box = setup();
    fireEvent.change(box, { target: { value: '日本語' } });

    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, isComposing: true });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, shiftKey: true });

    expect(createStrategyComment).not.toHaveBeenCalled();
  });

  it('honors an explicit "Enter" send-shortcut preference, and Shift+Enter still inserts a newline in that mode', async () => {
    localStorage.setItem('clayware:pref:send-comment-shortcut', 'Enter');
    createStrategyComment.mockImplementation(async (input: { content: string }) =>
      comment({ id: 'new', content: input.content }));
    const box = setup();

    fireEvent.change(box, { target: { value: 'quick note' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(createStrategyComment).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });

    await vi.waitFor(() => expect(createStrategyComment).toHaveBeenCalledTimes(1));
  });

  it('puts a comment back when the delete fails', async () => {
    thread = [comment({ id: 'c1', content: 'still true' })];
    deleteStrategyComment.mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    setup();

    await screen.findByText('still true');
    // The "…" menu is Radix's DropdownMenu, which opens on a real pointer
    // sequence — a bare fireEvent.click doesn't trigger it in jsdom.
    await user.click(screen.getByTitle('More'));
    await user.click(await screen.findByText('Delete'));

    await vi.waitFor(() => expect(deleteStrategyComment).toHaveBeenCalledWith('c1'));
    await screen.findByText('still true');
  });

  it("offers delete on an agent's comment only to the Strategy's owner", async () => {
    thread = [comment({ id: 'c9', author_id: null, author_kind: 'ai_agent', author_name: 'Claude', content: 'agent report' })];
    const user = userEvent.setup();

    setup({ strategyOwnerId: OTHER_ID });
    await screen.findByText('agent report');
    expect(screen.queryByTitle('More')).toBeNull();

    cleanup();
    setup({ strategyOwnerId: USER_ID });
    await screen.findByText('agent report');
    await user.click(screen.getByTitle('More'));
    expect(await screen.findByText('Delete')).toBeTruthy();
  });
});
