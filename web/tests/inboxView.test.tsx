/** @vitest-environment jsdom */
//
// Three things the Inbox got wrong, none of which tsc or design-lint can see:
//
//   - a `kind` this build has never heard of took the whole list down with it
//     (KIND_META[n.kind].icon on a plain text column with no CHECK),
//   - clicking a notification about an Element called onViewChange('domain-elements')
//     with no id — an Execution-mode list of everything, from a Home surface,
//     while notifications.comment_id sat written and unread,
//   - the row was an <li onClick>: no role, no tabIndex, no key handler, so
//     the entire feed was unreachable without a mouse.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Notification } from '@/types/database';

const USER_ID = 'user-1';

let feed: Notification[] = [];
const markNotificationRead = vi.fn().mockResolvedValue(undefined);
const fetchElementWithDetails = vi.fn();
const detailProps = vi.fn();

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    recipient_id: USER_ID,
    actor_id: null,
    actor_name: 'Claude',
    kind: 'comment',
    element_id: 'el-1',
    comment_id: 'c-9',
    strategy_id: null,
    strategy_comment_id: null,
    object_id: null,
    brief_id: null,
    title: 'Claude commented on Wire the Inbox',
    body: 'progress',
    is_read: false,
    is_archived: false,
    created_at: new Date().toISOString(),
    ...over,
  };
}

vi.mock('@/hooks/useSupabase', () => ({
  markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  archiveNotification: vi.fn().mockResolvedValue(undefined),
  fetchElementWithDetails: (...a: unknown[]) => fetchElementWithDetails(...a),
  // Stands in for the shared store: the view owns the list after mount and
  // drives it through the setter, exactly as the real hook does.
  useNotifications: () => {
    const { useState } = require('react');
    const [notifications, setNotifications] = useState(feed);
    return {
      notifications,
      unreadCount: notifications.filter((n: Notification) => !n.is_read).length,
      loading: false,
      reload: () => {},
      setNotifications,
    };
  },
}));

// The detail view itself is not what is being tested — which Element it is
// opened on, and at which comment, is.
vi.mock('@/alcon/element/ElementDetailView', () => ({
  ElementDetailView: (props: Record<string, unknown>) => {
    detailProps(props);
    return <div data-testid="element-detail">{(props.element as { title: string }).title}</div>;
  },
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: USER_ID }, profile: { display_name: 'Me' } }),
}));

const { InboxView } = await import('@/alcon/element/actions/InboxView');

beforeEach(() => {
  feed = [notification()];
  markNotificationRead.mockClear();
  detailProps.mockClear();
  fetchElementWithDetails.mockReset();
  fetchElementWithDetails.mockResolvedValue({
    id: 'el-1', title: 'Wire the Inbox', objects: [{ id: 'ob-1', name: 'Board' }],
    subelements: [], assignees: [], objectIds: ['ob-1'], isMultiHomed: false,
  });
});
afterEach(cleanup);

describe('a notification is something you can follow', () => {
  it('opens the Element it names, at the comment it names, without leaving Home', async () => {
    const onViewChange = vi.fn();
    const onNavigate = vi.fn();
    render(<InboxView onViewChange={onViewChange} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /commented on Wire the Inbox/ }));

    await vi.waitFor(() => expect(screen.getByTestId('element-detail')).toBeTruthy());
    expect(fetchElementWithDetails).toHaveBeenCalledWith('el-1');
    // comment_id has always been written; this is the first thing to read it.
    expect(detailProps.mock.calls.at(-1)?.[0].focusCommentId).toBe('c-9');
    // The rail must not jump to Execution, and certainly not to a list of
    // every Element with no id.
    expect(onViewChange).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('says so when the Element a notification names is gone', async () => {
    fetchElementWithDetails.mockResolvedValue(null);
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /commented on Wire the Inbox/ }));
    await vi.waitFor(() => expect(screen.getByText(/no longer available/i)).toBeTruthy());
    expect(screen.queryByTestId('element-detail')).toBeNull();
  });

  it('still follows a Initiative notification into the Initiative', async () => {
    feed = [notification({ element_id: null, comment_id: null, strategy_id: 's-1', title: 'Ana commented on Q3' })];
    const onViewChange = vi.fn();
    const onNavigate = vi.fn();
    render(<InboxView onViewChange={onViewChange} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /commented on Q3/ }));
    await vi.waitFor(() => expect(onViewChange).toHaveBeenCalledWith('strategy'));
    expect(onNavigate).toHaveBeenCalledWith({ strategyId: 's-1' });
  });
});

describe('the feed survives a kind it has never heard of', () => {
  it('renders the row instead of throwing, and names the kind', () => {
    feed = [
      notification({ id: 'n-known', kind: 'status_change', title: 'Wire the Inbox is done', body: 'in_progress → done' }),
      // `kind` is a plain text column: a newer deploy's value can land here.
      notification({ id: 'n-unknown', kind: 'thread_resolved' as Notification['kind'], title: 'Something new happened' }),
    ];
    render(<InboxView />);

    expect(screen.getByText('Wire the Inbox is done')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Something new happened')).toBeTruthy();
    expect(screen.getByText('thread resolved')).toBeTruthy();
  });
});

describe('the feed is reachable without a mouse', () => {
  it('gives every row and row action a real button', () => {
    feed = [notification()];
    render(<InboxView />);

    const row = screen.getByRole('button', { name: /commented on Wire the Inbox/ });
    expect(row.tagName).toBe('BUTTON');
    // The row's own actions are separately focusable, not hover-only affordances
    // hidden behind a pointer.
    expect(screen.getByRole('button', { name: 'Mark as read' }).tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Archive' }).tagName).toBe('BUTTON');
  });

  it('puts the row in the tab order', () => {
    feed = [notification({ id: 'a' }), notification({ id: 'b', title: 'Claude commented on Something else' })];
    const { container } = render(<InboxView />);

    // Tab order, as the browser builds it. jsdom will not synthesize the
    // activation click that Enter produces on a <button>, so what is asserted
    // is the thing that guarantees it: every row is a natively focusable
    // button that Tab reaches. An <li onClick> appears in neither list.
    const focusable = Array.from(container.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    const rows = screen.getAllByRole('button', { name: /commented on/ });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tagName).toBe('BUTTON');
      expect(focusable).toContain(row);
      row.focus();
      expect(document.activeElement).toBe(row);
    }
  });
});
