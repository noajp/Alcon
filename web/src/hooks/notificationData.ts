'use client';

import { supabase } from '@/lib/supabase';
import type { Notification } from '@/types/database';
import { useCurrentUserId } from '@/providers/authContext';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';


// ============================================
// Notifications (Inbox)
// ============================================
async function fetchNotifications(opts: {
  recipientId: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<Notification[]> {
  let q = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', opts.recipientId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });
  if (opts.unreadOnly) q = q.eq('is_read', false);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Notification[];
}

export async function markNotificationRead(id: string, isRead = true): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: isRead })
    .eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(recipientId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', recipientId)
    .eq('is_read', false);
  if (error) throw error;
}

export async function archiveNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_archived: true })
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// The Inbox feed is one thing, so it gets one store.
//
// The sidebar badge and the Inbox view are two windows onto the same list.
// Given a hook instance each they opened a realtime subscription each, and
// every instance answered every event by refetching the whole feed. "Mark all
// read" over 53 rows is 53 UPDATE events, so the client fetched all 53 rows
// 106 times to learn something it had already written itself.
//
// Two fixes, and they are one idea: hold the feed once, and treat a realtime
// event as the news it already contains rather than as a reason to ask again.
// A refetch remains available (`reload`) for the cases where the payload isn't
// enough — the initial load, and recovering from a failed write.
// ---------------------------------------------------------------------------

interface InboxStore {
  recipientId: string | null;
  /** Replaced wholesale on every change: hook instances compare by identity. */
  snapshot: { notifications: Notification[]; loading: boolean };
  listeners: Set<() => void>;
  channel: ReturnType<typeof supabase.channel> | null;
  /** How many mounted hooks want the feed. The channel lives while > 0. */
  refCount: number;
  /** Guards against a slow fetch landing after a newer one (or a recipient change). */
  loadToken: number;
  emitTimer: ReturnType<typeof setTimeout> | null;
}

const inboxStore: InboxStore = {
  recipientId: null,
  snapshot: { notifications: [], loading: true },
  listeners: new Set(),
  channel: null,
  refCount: 0,
  loadToken: 0,
  emitTimer: null,
};

const EMPTY_INBOX: Notification[] = [];

function emitInbox() {
  if (inboxStore.emitTimer) { clearTimeout(inboxStore.emitTimer); inboxStore.emitTimer = null; }
  for (const listen of inboxStore.listeners) listen();
}

/** Realtime arrives one websocket message per row; a burst (mark-all-read)
 *  should cost one render, not one per row. Local edits skip this and emit
 *  straight away so a click feels immediate. */
function emitInboxSoon() {
  if (inboxStore.emitTimer) return;
  inboxStore.emitTimer = setTimeout(() => { inboxStore.emitTimer = null; emitInbox(); }, 0);
}

function setInboxState(
  next: Partial<InboxStore['snapshot']>,
  schedule: 'now' | 'soon' = 'now',
) {
  inboxStore.snapshot = { ...inboxStore.snapshot, ...next };
  if (schedule === 'now') emitInbox(); else emitInboxSoon();
}

const byNewestFirst = (a: Notification, b: Notification) => b.created_at.localeCompare(a.created_at);

/** Fold one realtime payload into the list. Archiving is how a row leaves the
 *  Inbox, so an UPDATE that sets is_archived removes it. */
function applyInboxEvent(payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<Notification>;
  old: Partial<Notification>;
}) {
  const list = inboxStore.snapshot.notifications;
  const row = payload.new as Notification | undefined;
  const id = (payload.new?.id ?? payload.old?.id) as string | undefined;
  if (!id) return;

  if (payload.eventType === 'DELETE') {
    if (!list.some(n => n.id === id)) return;
    setInboxState({ notifications: list.filter(n => n.id !== id) }, 'soon');
    return;
  }
  if (!row || row.is_archived) {
    if (!list.some(n => n.id === id)) return;
    setInboxState({ notifications: list.filter(n => n.id !== id) }, 'soon');
    return;
  }
  const at = list.findIndex(n => n.id === id);
  if (at === -1) {
    setInboxState({ notifications: [row, ...list].sort(byNewestFirst) }, 'soon');
    return;
  }
  const merged = { ...list[at], ...row };
  const next = [...list];
  next[at] = merged;
  setInboxState({ notifications: next }, 'soon');
}

async function loadInbox() {
  const recipientId = inboxStore.recipientId;
  const token = ++inboxStore.loadToken;
  if (!recipientId) { setInboxState({ notifications: EMPTY_INBOX, loading: false }); return; }
  setInboxState({ loading: true });
  try {
    const list = await fetchNotifications({ recipientId });
    if (token !== inboxStore.loadToken) return;
    setInboxState({ notifications: list, loading: false });
  } catch (e) {
    console.error('Failed to load notifications:', e);
    if (token === inboxStore.loadToken) setInboxState({ loading: false });
  }
}

function openInboxChannel() {
  const recipientId = inboxStore.recipientId;
  if (!recipientId || inboxStore.channel) return;
  inboxStore.channel = supabase
    .channel(`notifications:${recipientId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${recipientId}` },
      (payload) => {
        applyInboxEvent(payload as unknown as Parameters<typeof applyInboxEvent>[0]);
      },
    )
    .subscribe();
}

function closeInboxChannel() {
  if (!inboxStore.channel) return;
  void supabase.removeChannel(inboxStore.channel);
  inboxStore.channel = null;
}

function retainInbox(recipientId: string | null) {
  inboxStore.refCount += 1;
  if (inboxStore.recipientId !== recipientId) {
    closeInboxChannel();
    inboxStore.recipientId = recipientId;
    setInboxState({ notifications: EMPTY_INBOX, loading: !!recipientId });
    openInboxChannel();
    void loadInbox();
  } else if (inboxStore.refCount === 1) {
    openInboxChannel();
    void loadInbox();
  }
}

function releaseInbox() {
  inboxStore.refCount = Math.max(0, inboxStore.refCount - 1);
  if (inboxStore.refCount === 0) closeInboxChannel();
}

function subscribeInbox(listen: () => void) {
  inboxStore.listeners.add(listen);
  return () => { inboxStore.listeners.delete(listen); };
}

const getInboxSnapshot = () => inboxStore.snapshot;

/** Same shape as a `useState` setter so callers keep writing optimistic
 *  updates the way they always have — it just lands in the shared store, and
 *  the sidebar badge moves with the list. */
function setInboxNotifications(update: Notification[] | ((prev: Notification[]) => Notification[])) {
  const prev = inboxStore.snapshot.notifications;
  const next = typeof update === 'function' ? update(prev) : update;
  if (next === prev) return;
  setInboxState({ notifications: next });
}

export function useNotifications(recipientId: string | null) {
  const snapshot = useSyncExternalStore(subscribeInbox, getInboxSnapshot, getInboxSnapshot);

  useEffect(() => {
    retainInbox(recipientId);
    return () => { releaseInbox(); };
  }, [recipientId]);

  const reload = useCallback(() => { void loadInbox(); }, []);
  const notifications = snapshot.notifications;
  const unreadCount = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications]);

  return {
    notifications,
    unreadCount,
    loading: snapshot.loading,
    reload,
    setNotifications: setInboxNotifications,
  };
}

/** Kinds the app announces itself. Comments, mentions, done / blocked and due
 *  dates are notified by the database when the row is written. */
export type ElementNotifyKind = 'assigned' | 'status_change' | 'approval_decided';

/**
 * Tell the people on an Element about something the caller just did there.
 *
 * Browsers cannot write notifications directly. The `notify_about_element`
 * RPC checks that the caller really did it (the assignment row, their status
 * change, their approval decision — each within ten minutes and still matching
 * the Element), picks the recipients from the Element, drops anyone who cannot
 * see it, and writes the text itself. Pass `workerId` for 'assigned'. A failed
 * notification never undoes the action, so errors are logged, not thrown.
 */
export async function notifyAboutElement(
  elementId: string,
  kind: ElementNotifyKind,
  workerId?: string,
): Promise<void> {
  const { error } = await supabase.rpc('notify_about_element', {
    p_element_id: elementId,
    p_kind: kind,
    p_worker_id: workerId ?? null,
  });
  if (error) console.error('notifyAboutElement failed:', error);
}

/** Comment and mention notifications are what "a new comment you have not
 *  read" means on an Element. */
const COMMENT_KINDS: Notification['kind'][] = ['comment', 'mention'];

/** The Elements with a comment the signed-in person has not read yet — from
 *  the Inbox's own store, so reading one there clears the mark in lists too. */
export function useUnreadCommentElementIds(): ReadonlySet<string> {
  const userId = useCurrentUserId();
  const { notifications } = useNotifications(userId);
  return useMemo(() => new Set(notifications
    .filter((n) => !n.is_read && !n.is_archived && n.element_id && COMMENT_KINDS.includes(n.kind))
    .map((n) => n.element_id!)), [notifications]);
}

/** Opening an Element reads its comments: its unread comment and mention
 *  notifications for this person become read. */
export async function markElementCommentsRead(recipientId: string, elementId: string): Promise<void> {
  const unread = inboxStore.snapshot.notifications.some((n) =>
    !n.is_read && n.element_id === elementId && COMMENT_KINDS.includes(n.kind));
  if (!unread) return;
  setInboxNotifications((prev) => prev.map((n) =>
    n.element_id === elementId && COMMENT_KINDS.includes(n.kind) ? { ...n, is_read: true } : n));
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', recipientId)
    .eq('element_id', elementId)
    .in('kind', COMMENT_KINDS)
    .eq('is_read', false);
  if (error) console.error('Could not mark the comments read:', error);
}
