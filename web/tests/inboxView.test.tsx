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
import { useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MembershipInvitation, Notification } from '@/types/database';

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
    intent_id: null,
    strategy_comment_id: null,
    object_id: null,
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
  // Stands in for the shared store: the sidebar list and the reader both
  // read one feed and drive it through the setter, exactly as the real hook does.
  useNotifications: () => {
    const notifications: Notification[] = useSyncExternalStore(subscribeFeed, () => feed, () => feed);
    return {
      notifications,
      unreadCount: notifications.filter((n: Notification) => !n.is_read).length,
      loading: false,
      reload: () => {},
      setNotifications: setFeed,
    };
  },
}));

const feedListeners = new Set<() => void>();
function subscribeFeed(listener: () => void) { feedListeners.add(listener); return () => { feedListeners.delete(listener); }; }
function setFeed(update: Notification[] | ((prev: Notification[]) => Notification[])) {
  feed = typeof update === 'function' ? update(feed) : update;
  feedListeners.forEach(fn => fn());
}

// The detail view itself is not what is being tested — which Element it is
// opened on, and at which comment, is.
vi.mock('@/ActivitySpace/execution/element/ElementDetailView', () => ({
  ElementDetailView: (props: Record<string, unknown>) => {
    detailProps(props);
    return <div data-testid="element-detail">{(props.element as { title: string }).title}</div>;
  },
}));

// The invitation an 'invite' notification points at, as the reader loads it.
let invitationRow: MembershipInvitation | null = null;
const respondToInvite = vi.fn();
vi.mock('@/Function/membership/invitations', () => ({
  useInvitation: () => ({ invitation: invitationRow, loading: false }),
  respondToInvite: (...a: unknown[]) => respondToInvite(...a),
  invitationScope: (i: MembershipInvitation) => i.activity_space_id
    ? { scope: 'space', scopeId: i.activity_space_id }
    : i.domain_id ? { scope: 'domain', scopeId: i.domain_id } : { scope: 'object', scopeId: i.object_id },
  SCOPE_LABEL: { space: 'Space', domain: 'Domain', object: 'Object' },
}));

// What the active Space shows (ADR 0048); 'full' unless a test says otherwise.
let scope: 'audit' | 'full' = 'full';
vi.mock('@/Function/space/data', () => ({ useActiveSpaceScope: () => scope }));
// Resolving an Object's Domain reads the Domain lists; these tests follow
// notifications, so the lookup finds nothing and the plain route is taken.
vi.mock('@/ActivitySpace/home/useOpenObject', () => ({ useOpenObject: () => async () => false }));

vi.mock('@/providers/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: USER_ID }, profile: { display_name: 'Me' } }),
}));

const { InboxView: Reader } = await import('@/ActivitySpace/home/InboxView');
const { InboxList } = await import('@/ActivitySpace/home/InboxList');
const { selectInboxNotification } = await import('@/ActivitySpace/home/useInbox');

// The Inbox is two panes — the list in the AppSidebar, the reader in the main
// pane — joined by a shared selection. Tests mount both, as the shell does.
function InboxView(props: { onViewChange?: (view: string) => void; onNavigate?: (nav: object) => void }) {
  return <><InboxList {...props} /><Reader {...props} /></>;
}

beforeEach(() => {
  scope = 'full';
  feed = [notification()];
  selectInboxNotification(null);
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

  it('does not open the Element in a Space that shows the AI audit only', async () => {
    scope = 'audit';
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /commented on Wire the Inbox/ }));
    await vi.waitFor(() => expect(screen.getByText(/shows the AI audit only/)).toBeTruthy());
    expect(fetchElementWithDetails).not.toHaveBeenCalled();
    expect(screen.queryByTestId('element-detail')).toBeNull();
  });

  it('says so when the Element a notification names is gone', async () => {
    fetchElementWithDetails.mockResolvedValue(null);
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /commented on Wire the Inbox/ }));
    await vi.waitFor(() => expect(screen.getByText(/no longer available/i)).toBeTruthy());
    expect(screen.queryByTestId('element-detail')).toBeNull();
  });

  it('still follows a Strategy notification into the Strategy', async () => {
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
  it('gives rows and selected notification actions real buttons', async () => {
    feed = [notification()];
    render(<InboxView />);

    const row = screen.getByRole('button', { name: /commented on Wire the Inbox/ });
    expect(row.tagName).toBe('BUTTON');
    // Actions stay labelled in the reader instead of covering row text.
    fireEvent.click(row);
    await vi.waitFor(() => expect(screen.getByTestId('element-detail')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Mark as unread' }).tagName).toBe('BUTTON');
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

describe('the sidebar list tells the shell only when the reader opened', () => {
  it('reports an Element notification as opened, and a routed one as not', () => {
    feed = [
      notification({ id: 'el', title: 'Claude commented on Wire the Inbox' }),
      notification({ id: 'st', element_id: null, comment_id: null, strategy_id: 's-1', title: 'Ana commented on Q3' }),
    ];
    const onOpen = vi.fn();
    const onViewChange = vi.fn();
    render(<InboxList onOpen={onOpen} onViewChange={onViewChange} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /commented on Q3/ }));
    // Routed to the Strategy: the shell must not be told to stay on the Inbox.
    expect(onViewChange).toHaveBeenCalledWith('strategy');
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /commented on Wire the Inbox/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledTimes(1);
  });
});

describe('an invitation is answered in the reader, and only there does it become a membership', () => {
  function invitation(over: Partial<MembershipInvitation> = {}): MembershipInvitation {
    return {
      id: 'inv-1', activity_space_id: 'sp-1', domain_id: null, object_id: null,
      invitee_id: USER_ID, invited_by: 'user-2', role: 'member',
      scope_name: 'Acme', inviter_name: 'Ana', status: 'pending',
      created_at: new Date().toISOString(), responded_at: null,
      ...over,
    };
  }
  const invite = () => notification({
    id: 'n-inv', kind: 'invite', element_id: null, comment_id: null, invitation_id: 'inv-1',
    title: 'Ana invited you to Space Acme', body: 'You join when you accept.',
  });

  beforeEach(() => {
    respondToInvite.mockReset();
    feed = [invite()];
  });

  it('offers Accept as the one primary action and Decline beside it while pending', async () => {
    invitationRow = invitation();
    respondToInvite.mockResolvedValue('accepted');
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /invited you to Space Acme/ }));

    const accept = await screen.findByRole('button', { name: 'Accept' });
    const decline = screen.getByRole('button', { name: 'Decline' });
    expect(accept.getAttribute('data-variant')).toBe('primary');
    expect(decline.getAttribute('data-variant')).toBe('secondary');
    expect(screen.getByText('Ana invited you to Space Acme', { selector: 'p' })).toBeTruthy();
    // An invitation is not an Element: nothing is fetched for it.
    expect(fetchElementWithDetails).not.toHaveBeenCalled();

    fireEvent.click(accept);
    await vi.waitFor(() => expect(screen.getByText('You joined Space Acme.')).toBeTruthy());
    expect(respondToInvite).toHaveBeenCalledWith('inv-1', true);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('says how it was resolved instead of offering the choice again', async () => {
    invitationRow = invitation({ status: 'declined', responded_at: new Date().toISOString() });
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /invited you to Space Acme/ }));

    expect(await screen.findByText('You declined this invitation.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('says so when the invitation is gone', async () => {
    invitationRow = null;
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /invited you to Space Acme/ }));

    expect(await screen.findByText('This invitation no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });

  it('keeps the choice open when answering fails', async () => {
    invitationRow = invitation();
    respondToInvite.mockRejectedValue(new Error('This invitation no longer exists.'));
    render(<InboxView />);
    fireEvent.click(screen.getByRole('button', { name: /invited you to Space Acme/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await vi.waitFor(() => expect(screen.getByText('This invitation no longer exists.')).toBeTruthy());
    expect(respondToInvite).toHaveBeenCalledWith('inv-1', false);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
  });
});
