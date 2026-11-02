/** @vitest-environment jsdom */
//
// The Inbox feed is read by two components at once — the sidebar badge and the
// Inbox view — and before this change each of them held its own copy, its own
// realtime subscription, and answered every event by refetching everything.
// "Mark all read" over 53 rows meant 53 UPDATE events × 2 listeners = 106 full
// fetches of a list the client had just written itself.
//
// What is pinned down here is exactly that shape, because nothing else catches
// it: tsc, design-lint and every rendering test pass on the storming version.
//
//   - two mounted hooks share one realtime subscription,
//   - a realtime event costs zero fetches and is folded into the list,
//   - an optimistic write through one hook is visible to the other.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Notification } from '@/types/database';

// ---------------------------------------------------------------------------
// A supabase double: enough of the query builder for fetchNotifications, and a
// channel that hands us back the postgres_changes callback so the test can
// play the server.
// ---------------------------------------------------------------------------
let rows: Notification[] = [];
const fetchCalls = vi.fn();
const channelsOpened = vi.fn();
const channelsRemoved = vi.fn();
let emit: ((payload: unknown) => void) | null = null;

function queryBuilder() {
  const result = Promise.resolve({ data: rows, error: null });
  const builder: Record<string, unknown> = {
    then: (...args: unknown[]) => (result.then as (...a: unknown[]) => unknown)(...args),
  };
  for (const method of ['select', 'eq', 'order', 'limit']) {
    builder[method] = () => builder;
  }
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'notifications') fetchCalls();
      return queryBuilder();
    },
    channel: (topic: string) => {
      channelsOpened(topic);
      const channel = {
        on: (_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
          emit = cb;
          return channel;
        },
        subscribe: () => channel,
        topic,
      };
      return channel;
    },
    removeChannel: (channel: { topic: string }) => { channelsRemoved(channel.topic); },
  },
}));

// The module pulls in the whole hooks file; these are the only other things it
// touches at import time.
vi.mock('@/lib/queryClient', () => ({ getQueryClient: () => ({ getQueryData: () => undefined, setQueryData: () => {}, invalidateQueries: () => {} }) }));

const notification = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  recipient_id: 'user-1',
  actor_id: null,
  actor_name: 'Claude',
  kind: 'comment',
  element_id: 'el-1',
  comment_id: 'c-1',
  strategy_id: null,
  intent_id: null,
  strategy_comment_id: null,
  object_id: null,
  title: 'Claude commented on Wire the Inbox',
  body: 'progress',
  is_read: false,
  is_archived: false,
  created_at: '2026-08-30T00:00:00.000Z',
  ...over,
});

async function loadHook() {
  const { useNotifications } = await import('@/hooks/useSupabase');
  return useNotifications;
}

beforeEach(() => {
  vi.resetModules();
  rows = [];
  emit = null;
  fetchCalls.mockClear();
  channelsOpened.mockClear();
  channelsRemoved.mockClear();
});
afterEach(cleanup);

describe('the Inbox feed is held once', () => {
  it('opens one realtime subscription for two mounted readers', async () => {
    const useNotifications = await loadHook();
    rows = [notification()];

    const sidebar = renderHook(() => useNotifications('user-1'));
    const inbox = renderHook(() => useNotifications('user-1'));
    await act(async () => { await Promise.resolve(); });

    expect(channelsOpened).toHaveBeenCalledTimes(1);
    expect(sidebar.result.current.notifications).toHaveLength(1);
    expect(inbox.result.current.notifications).toHaveLength(1);
    expect(inbox.result.current.unreadCount).toBe(1);

    // ...and it survives one of them unmounting.
    inbox.unmount();
    expect(channelsRemoved).not.toHaveBeenCalled();
    expect(sidebar.result.current.notifications).toHaveLength(1);
  });

  it('folds a realtime UPDATE into the list instead of refetching it', async () => {
    const useNotifications = await loadHook();
    rows = [notification(), notification({ id: 'n2', title: 'second' })];

    const sidebar = renderHook(() => useNotifications('user-1'));
    const inbox = renderHook(() => useNotifications('user-1'));
    await act(async () => { await Promise.resolve(); });

    const fetchesAfterLoad = fetchCalls.mock.calls.length;
    expect(inbox.result.current.unreadCount).toBe(2);

    // The server echoing back a "mark all read": one message per row.
    await act(async () => {
      emit?.({ eventType: 'UPDATE', new: { ...notification(), is_read: true }, old: { id: 'n1' } });
      emit?.({ eventType: 'UPDATE', new: { ...notification({ id: 'n2', title: 'second' }), is_read: true }, old: { id: 'n2' } });
      await new Promise((r) => setTimeout(r, 5));
    });

    // The whole point: the payload was the news. Nothing was asked for again.
    expect(fetchCalls.mock.calls.length).toBe(fetchesAfterLoad);
    expect(inbox.result.current.unreadCount).toBe(0);
    expect(sidebar.result.current.unreadCount).toBe(0);
    expect(inbox.result.current.notifications).toHaveLength(2);
  });

  it('drops a row the server says is archived, and adds one it says is new', async () => {
    const useNotifications = await loadHook();
    rows = [notification()];
    const inbox = renderHook(() => useNotifications('user-1'));
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      emit?.({ eventType: 'UPDATE', new: { ...notification(), is_archived: true }, old: { id: 'n1' } });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(inbox.result.current.notifications).toHaveLength(0);

    await act(async () => {
      emit?.({
        eventType: 'INSERT',
        new: notification({ id: 'n3', kind: 'status_change', title: 'Wire the Inbox is done', created_at: '2026-08-31T00:00:00.000Z' }),
        old: {},
      });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(inbox.result.current.notifications.map(n => n.id)).toEqual(['n3']);
  });

  it('shows one reader the optimistic write made by the other', async () => {
    const useNotifications = await loadHook();
    rows = [notification()];
    const sidebar = renderHook(() => useNotifications('user-1'));
    const inbox = renderHook(() => useNotifications('user-1'));
    await act(async () => { await Promise.resolve(); });

    expect(sidebar.result.current.unreadCount).toBe(1);
    act(() => {
      inbox.result.current.setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    });
    // The badge moves with the list because there is only one list.
    expect(sidebar.result.current.unreadCount).toBe(0);
  });
});
